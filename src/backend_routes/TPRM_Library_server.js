// The question bank. Sectors, standards, instrument versions and their
// questions.
//
// The version freeze is the rule that matters here: a published instrument is
// immutable. To change a question you create a new draft version, edit that,
// and publish it. Assessments already under way stay bound to the version they
// started on, so a report that was issued last quarter still says what it said.

require("dotenv").config({ quiet: true });
const express = require("express");
const multer = require("multer");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requirePerm } = require('./utils/tprm_audit');
const classify = require('./utils/tprm_classify');
const excel = require('./utils/tprm_excel');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
// In memory: a question template is small and is parsed once, so there is
// nothing to gain from putting it on disk first.
const upload = multer({ storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 } });
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();

router.use(verifyJWT, tenantScope);

/* ---------------------------------------------------- reference lookups */
router.get("/sectors", async (_req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT s.sector_code, s.sector_name, s.sector_group,
                    (SELECT COUNT(*) FROM instrument_version iv
                      WHERE iv.sector_code = s.sector_code AND iv.status='published') AS published_versions,
                    (SELECT COUNT(*) FROM instrument_version iv
                      WHERE iv.sector_code = s.sector_code) AS versions,
                    (SELECT COUNT(*) FROM question q
                       JOIN instrument_version iv2
                         ON iv2.instrument_version_id = q.instrument_version_id
                      WHERE iv2.sector_code = s.sector_code) AS questions
               FROM sector s WHERE s.active = 1
              ORDER BY s.sector_group, s.sort_order`);
        res.json(rows);
    } catch (e) {
        logError("sectors", e, _req);
        res.status(500).json({ error: "Database error" });
    }
});

/* Each standard with the number of published instruments that map to it, and
   how many instruments there are in total - a standard nothing maps to is a
   claim the question bank does not actually support, and that has to be
   visible rather than inferred.

   A mapping is recorded in two places: instrument_standard, declared for the
   whole instrument, and question.standards_mapping, written per question while
   authoring. Counting only the first under-reports badly, because in practice
   the mapping is made where the question is written. */
router.get("/standards", async (_req, res) => {
    try {
        const [[tot]] = await db.query(
            `SELECT COUNT(DISTINCT sector_code) AS n
               FROM instrument_version WHERE status = 'published'`);
        const [rows] = await db.query(
            `SELECT s.standard_code, s.title, s.family, s.scope_note,
                    (SELECT COUNT(DISTINCT iv.sector_code)
                       FROM instrument_version iv
                      WHERE iv.status = 'published'
                        AND (EXISTS (SELECT 1 FROM instrument_standard ist
                                      WHERE ist.instrument_version_id = iv.instrument_version_id
                                        AND ist.standard_code = s.standard_code)
                          OR EXISTS (SELECT 1 FROM question q
                                      WHERE q.instrument_version_id = iv.instrument_version_id
                                        AND q.standards_mapping LIKE CONCAT(s.standard_code, '%')))
                    ) AS instruments
               FROM standard s
              WHERE s.active = 1
              ORDER BY s.family, s.standard_code`);
        res.json({ total: Number(tot.n), standards: rows });
    } catch (e) {
        logError("standards", e, _req);
        res.status(500).json({ error: "Database error" });
    }
});

router.get("/domains", async (_req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT domain_code, domain_name, default_weight FROM control_domain ORDER BY sort_order`);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: "Database error" });
    }
});

router.get("/dimensions", async (_req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT dimension_code, dimension_name, default_weight, note
               FROM tiering_dimension ORDER BY sort_order`);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------------------------ one sector's question bank */
router.get("/instruments/:sectorCode", async (req, res) => {
    try {
        const [versions] = await db.query(
            `SELECT instrument_version_id, version_no, status, frozen, change_note,
                    published_time, created_time
               FROM instrument_version WHERE sector_code = ?
              ORDER BY version_no DESC`,
            [req.params.sectorCode]
        );
        if (!versions.length) {
            return res.json({ versions: [], current: null, questions: [] });
        }

        // Show the requested version, else the newest published one, else the
        // newest draft.
        const wanted = req.query.versionId
            ? versions.find(v => String(v.instrument_version_id) === String(req.query.versionId))
            : null;
        const current = wanted
            || versions.find(v => v.status === 'published')
            || versions[0];

        const [questions] = await db.query(
            `SELECT q.question_id, q.q_type, q.q_ref, q.is_core, q.dimension_code, q.domain_code,
                    q.q_text, q.score_1_label, q.score_2_label, q.score_3_label,
                    q.evidence_required, q.standards_mapping, q.tier_applies, q.sort_order,
                    q.rationale,
                    cd.domain_name, td.dimension_name
               FROM question q
               LEFT JOIN control_domain cd ON cd.domain_code = q.domain_code
               LEFT JOIN tiering_dimension td ON td.dimension_code = q.dimension_code
              WHERE q.instrument_version_id = ?
              ORDER BY q.q_type DESC, q.sort_order, q.q_ref`,
            [current.instrument_version_id]
        );
        const [standards] = await db.query(
            `SELECT standard_code FROM instrument_standard WHERE instrument_version_id = ?`,
            [current.instrument_version_id]
        );

        res.json({
            versions, current, questions,
            standards: standards.map(s => s.standard_code),
        });
    } catch (e) {
        logError("instruments", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------- clone the current version into a new draft */
router.post("/instruments/:sectorCode/draft", requirePerm('instrument.author'), async (req, res) => {
    const conn = await db.getConnection();
    try {
        const sector = req.params.sectorCode;
        await conn.beginTransaction();

        const [[open]] = await conn.query(
            `SELECT instrument_version_id FROM instrument_version
              WHERE sector_code=? AND status='draft' LIMIT 1`, [sector]);
        if (open) {
            await conn.rollback();
            return res.status(409).json({
                error: "DRAFT_EXISTS",
                message: "A draft already exists for this sector. Publish or discard it first.",
            });
        }

        const [[latest]] = await conn.query(
            `SELECT instrument_version_id, version_no FROM instrument_version
              WHERE sector_code=? ORDER BY version_no DESC LIMIT 1`, [sector]);
        const nextNo = latest ? Number(latest.version_no) + 1 : 1;

        const [ins] = await conn.query(
            `INSERT INTO instrument_version (sector_code, version_no, status, change_note, authored_by)
             VALUES (?,?,'draft',?,?)`,
            [sector, nextNo, req.body.changeNote || null, req.emp_id]
        );
        const newId = ins.insertId;

        // Copy the questions and standards forward so an author edits a real
        // starting point rather than an empty sheet.
        if (latest) {
            await conn.query(
                `INSERT INTO question
                   (instrument_version_id, q_type, q_ref, is_core, dimension_code, domain_code, q_text,
                    score_1_label, score_2_label, score_3_label, rationale, evidence_required,
                    standards_mapping, tier_applies, sort_order)
                 SELECT ?, q_type, q_ref, is_core, dimension_code, domain_code, q_text,
                        score_1_label, score_2_label, score_3_label, rationale, evidence_required,
                        standards_mapping, tier_applies, sort_order
                   FROM question WHERE instrument_version_id = ?`,
                [newId, latest.instrument_version_id]
            );
            await conn.query(
                `INSERT IGNORE INTO instrument_standard (instrument_version_id, standard_code)
                 SELECT ?, standard_code FROM instrument_standard WHERE instrument_version_id = ?`,
                [newId, latest.instrument_version_id]
            );
        }

        await conn.commit();
        await audit(req, {
            action: 'instrument.draft_created', entity: 'instrument_version', entityId: newId,
            after: { sector, version: nextNo },
        });
        res.status(201).json({ success: true, instrument_version_id: newId, version_no: nextNo });
    } catch (e) {
        await conn.rollback().catch(() => {});
        logError("draft", e, req);
        res.status(500).json({ error: "Database error" });
    } finally {
        conn.release();
    }
});

router.post("/instruments/version/:id/publish", requirePerm('instrument.publish'), async (req, res) => {
    const conn = await db.getConnection();
    try {
        const [[iv]] = await conn.query(
            `SELECT * FROM instrument_version WHERE instrument_version_id=?`, [req.params.id]);
        if (!iv) return res.status(404).json({ error: "That instrument version does not exist" });
        if (iv.status !== 'draft') {
            return res.status(400).json({ error: "NOT_A_DRAFT", message: "Only a draft can be published" });
        }
        /* An instrument needs both halves to do its job. The control questions
           are what the supplier answers; the tiering questions are what decides
           how many of them that supplier is asked in the first place. Publishing
           with either side empty produces an instrument that cannot complete a
           single assessment - and publishing is the one act here that cannot be
           undone, because a published version is frozen. */
        const [[count]] = await conn.query(
            `SELECT SUM(q_type='tiering') AS tiering, SUM(q_type='control') AS control
               FROM question WHERE instrument_version_id=?`, [req.params.id]);
        const nTier = Number(count.tiering) || 0;
        const nCtl = Number(count.control) || 0;
        if (!nTier || !nCtl) {
            const missing = !nTier && !nCtl ? "no questions at all"
                : !nTier ? "no tiering questions" : "no control questions";
            return res.status(400).json({
                error: !nCtl ? "NO_CONTROLS" : "NO_TIERING",
                message: `This version has ${missing}. An instrument needs both a tiering set, `
                    + `which decides the supplier's tier, and a control set, which is what the `
                    + `supplier answers. Add the missing side before publishing.`,
                details: [{ field: 'questions', message: `${nTier} tiering, ${nCtl} control` }],
            });
        }

        await conn.beginTransaction();
        await conn.query(
            `UPDATE instrument_version SET status='retired', retired_time=NOW(3)
              WHERE sector_code=? AND status='published'`, [iv.sector_code]);
        await conn.query(
            `UPDATE instrument_version SET status='published', frozen=1,
                    published_by=?, published_time=NOW(3) WHERE instrument_version_id=?`,
            [req.emp_id, req.params.id]);
        await conn.commit();

        await audit(req, {
            action: 'instrument.published', entity: 'instrument_version', entityId: iv.instrument_version_id,
            after: { sector: iv.sector_code, version: iv.version_no },
        });
        res.json({
            success: true,
            message: "Published. Assessments already under way keep the version they started on.",
        });
    } catch (e) {
        await conn.rollback().catch(() => {});
        logError("publish", e, req);
        res.status(500).json({ error: "Database error" });
    } finally {
        conn.release();
    }
});

/* -------------------------------------------- edit a draft question only */
/* ============================================== authoring a draft ======
   Everything below edits questions, and every one of them refuses unless the
   version is still a draft. That rule is the product's promise: a published
   instrument is frozen, so a report issued last month cannot change meaning
   underneath the client who received it.

   The check is repeated per route rather than hoisted into middleware because
   two of them are reached by question id and two by version id, and a guard
   that has to work out which is a guard people eventually get wrong. */

/** Loads a question with the status of the version it belongs to. */
async function draftQuestion(id) {
    const [[q]] = await db.query(
        `SELECT q.*, iv.status, iv.instrument_version_id AS ivid, iv.sector_code
           FROM question q
           JOIN instrument_version iv ON iv.instrument_version_id = q.instrument_version_id
          WHERE q.question_id = ?`, [id]);
    return q || null;
}

const FROZEN = {
    error: "VERSION_FROZEN",
    message: "Published versions are immutable. Create a draft version to make changes.",
};

/** A tiering question is scored 1-3 against a dimension; a control question
 *  takes a position against a domain. The database enforces this with a CHECK
 *  constraint, so rejecting it here is only about the error the author reads. */
function shapeError(body) {
    if (body.qType === 'tiering' && !body.dimensionCode) {
        return "A tiering question needs a dimension - it is scored against one.";
    }
    if (body.qType === 'control' && !body.domainCode) {
        return "A control question needs a control area.";
    }
    if (!['tiering', 'control'].includes(body.qType)) {
        return "A question is either tiering or control.";
    }
    if (!String(body.qText || "").trim()) return "The question needs wording.";
    if (!String(body.qRef || "").trim()) return "The question needs a reference.";
    return null;
}

// POST a new question onto a draft.
router.post("/instruments/version/:id/questions", requirePerm('instrument.author'), async (req, res) => {
    try {
        const [[iv]] = await db.query(
            `SELECT instrument_version_id, status, sector_code FROM instrument_version
              WHERE instrument_version_id = ?`, [req.params.id]);
        if (!iv) return res.status(404).json({ error: "That version does not exist" });
        if (iv.status !== 'draft') return res.status(400).json(FROZEN);

        const bad = shapeError(req.body);
        if (bad) return res.status(400).json({ error: "BAD_SHAPE", message: bad });

        const qRef = String(req.body.qRef).trim().toUpperCase();
        const [[dupe]] = await db.query(
            `SELECT question_id FROM question WHERE instrument_version_id=? AND q_ref=?`,
            [iv.instrument_version_id, qRef]);
        if (dupe) {
            return res.status(409).json({
                error: "REF_TAKEN",
                message: `${qRef} is already used in this version. References identify a question in returned workbooks, so they have to be unique.`,
            });
        }

        // New questions land at the end of their own type's list.
        const [[last]] = await db.query(
            `SELECT COALESCE(MAX(sort_order), 0) AS n FROM question
              WHERE instrument_version_id=? AND q_type=?`,
            [iv.instrument_version_id, req.body.qType]);

        const [ins] = await db.query(
            `INSERT INTO question
               (instrument_version_id, q_type, q_ref, dimension_code, domain_code, q_text,
                score_1_label, score_2_label, score_3_label, rationale,
                evidence_required, standards_mapping, tier_applies, sort_order)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                iv.instrument_version_id, req.body.qType, qRef,
                req.body.qType === 'tiering' ? req.body.dimensionCode : null,
                req.body.qType === 'control' ? req.body.domainCode : null,
                String(req.body.qText).trim(),
                req.body.score1 || null, req.body.score2 || null, req.body.score3 || null,
                req.body.rationale || null,
                req.body.evidenceRequired || null, req.body.standardsMapping || null,
                Number(req.body.tierApplies) || 3,
                Number(last.n) + 10,
            ]);

        await audit(req, {
            action: 'question.created', entity: 'question', entityId: ins.insertId,
            after: { version: iv.instrument_version_id, q_ref: qRef, q_type: req.body.qType },
        });
        res.status(201).json({ success: true, question_id: ins.insertId });
    } catch (e) {
        logError("question POST", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

// PUT an edit onto a draft question. Every authored field, not just four.
router.put("/questions/:id", requirePerm('instrument.author'), async (req, res) => {
    try {
        const q = await draftQuestion(req.params.id);
        if (!q) return res.status(404).json({ error: "That question does not exist" });
        if (q.status !== 'draft') return res.status(400).json(FROZEN);

        const body = { qType: q.q_type, ...req.body };
        const bad = shapeError({
            qType: body.qType,
            dimensionCode: body.dimensionCode !== undefined ? body.dimensionCode : q.dimension_code,
            domainCode: body.domainCode !== undefined ? body.domainCode : q.domain_code,
            qText: body.qText !== undefined ? body.qText : q.q_text,
            qRef: body.qRef !== undefined ? body.qRef : q.q_ref,
        });
        if (bad) return res.status(400).json({ error: "BAD_SHAPE", message: bad });

        const qRef = req.body.qRef ? String(req.body.qRef).trim().toUpperCase() : q.q_ref;
        if (qRef !== q.q_ref) {
            const [[dupe]] = await db.query(
                `SELECT question_id FROM question
                  WHERE instrument_version_id=? AND q_ref=? AND question_id<>?`,
                [q.ivid, qRef, q.question_id]);
            if (dupe) return res.status(409).json({ error: "REF_TAKEN", message: `${qRef} is already used in this version.` });
        }

        // COALESCE keeps an omitted field at its current value, so a caller can
        // send one changed field without having to echo the whole question back.
        await db.query(
            `UPDATE question SET
               q_ref             = ?,
               dimension_code    = ?,
               domain_code       = ?,
               q_text            = COALESCE(?, q_text),
               score_1_label     = COALESCE(?, score_1_label),
               score_2_label     = COALESCE(?, score_2_label),
               score_3_label     = COALESCE(?, score_3_label),
               rationale         = COALESCE(?, rationale),
               evidence_required = COALESCE(?, evidence_required),
               standards_mapping = COALESCE(?, standards_mapping),
               tier_applies      = COALESCE(?, tier_applies)
             WHERE question_id = ?`,
            [
                qRef,
                q.q_type === 'tiering'
                    ? (req.body.dimensionCode || q.dimension_code) : null,
                q.q_type === 'control'
                    ? (req.body.domainCode || q.domain_code) : null,
                req.body.qText || null,
                req.body.score1 || null, req.body.score2 || null, req.body.score3 || null,
                req.body.rationale || null,
                req.body.evidenceRequired || null, req.body.standardsMapping || null,
                req.body.tierApplies || null,
                req.params.id,
            ]);

        await audit(req, {
            action: 'question.updated', entity: 'question', entityId: q.question_id,
            before: { q_ref: q.q_ref, q_text: q.q_text, tier_applies: q.tier_applies },
            after: { q_ref: qRef, q_text: req.body.qText, tier_applies: req.body.tierApplies },
        });
        res.json({ success: true });
    } catch (e) {
        logError("question PUT", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

// DELETE a question from a draft.
router.delete("/questions/:id", requirePerm('instrument.author'), async (req, res) => {
    try {
        const q = await draftQuestion(req.params.id);
        if (!q) return res.status(404).json({ error: "That question does not exist" });
        if (q.status !== 'draft') return res.status(400).json(FROZEN);

        await db.query(`DELETE FROM question WHERE question_id=?`, [req.params.id]);
        await audit(req, {
            action: 'question.deleted', entity: 'question', entityId: q.question_id,
            before: { q_ref: q.q_ref, q_text: q.q_text, version: q.ivid },
        });
        res.json({ success: true });
    } catch (e) {
        logError("question DELETE", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

// PUT the change note. Editable for exactly as long as the version is a draft.
//
// It was write-once at creation, which had it backwards: every question in a
// draft can be added, edited, reordered and deleted, but the sentence saying
// why the draft exists was frozen from the moment it was typed. A typo in it
// meant discarding the draft and starting again.
//
// It freezes on publish with everything else, because by then it is the change
// note attached to a version somebody has been assessed against.
router.put("/instruments/version/:id", requirePerm('instrument.author'), async (req, res) => {
    try {
        const [[iv]] = await db.query(
            `SELECT instrument_version_id, status, change_note, sector_code, version_no
               FROM instrument_version WHERE instrument_version_id=?`, [req.params.id]);
        if (!iv) return res.status(404).json({ error: "That version does not exist" });
        if (iv.status !== 'draft') {
            return res.status(400).json({
                error: "VERSION_FROZEN",
                message: "Published versions are immutable, change note included.",
            });
        }

        const note = String(req.body.changeNote || "").trim();
        if (note.length < 5) {
            return res.status(400).json({
                error: "NOTE_TOO_SHORT",
                message: "Say what is changing in this version, in at least 5 characters. It is what a reader sees next to the version months from now.",
            });
        }

        await db.query(
            `UPDATE instrument_version SET change_note=? WHERE instrument_version_id=?`,
            [note, req.params.id]);
        await audit(req, {
            action: 'instrument.note_updated', entity: 'instrument_version',
            entityId: iv.instrument_version_id,
            before: { change_note: iv.change_note }, after: { change_note: note },
        });
        res.json({ success: true });
    } catch (e) {
        logError("version note PUT", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

// PUT a new running order. Takes the ids in the order they should appear.
router.put("/instruments/version/:id/order", requirePerm('instrument.author'), async (req, res) => {
    const conn = await db.getConnection();
    try {
        const [[iv]] = await conn.query(
            `SELECT status FROM instrument_version WHERE instrument_version_id=?`, [req.params.id]);
        if (!iv) return res.status(404).json({ error: "That version does not exist" });
        if (iv.status !== 'draft') return res.status(400).json(FROZEN);

        const ids = Array.isArray(req.body.questionIds) ? req.body.questionIds : [];
        if (!ids.length) return res.status(400).json({ error: "questionIds required" });

        await conn.beginTransaction();
        // Spaced by ten so a later single-question move can be written without
        // renumbering the whole list.
        for (let i = 0; i < ids.length; i++) {
            await conn.query(
                `UPDATE question SET sort_order=? WHERE question_id=? AND instrument_version_id=?`,
                [(i + 1) * 10, ids[i], req.params.id]);
        }
        await conn.commit();
        await audit(req, {
            action: 'question.reordered', entity: 'instrument_version', entityId: req.params.id,
            after: { count: ids.length },
        });
        res.json({ success: true });
    } catch (e) {
        await conn.rollback().catch(() => {});
        logError("question order", e, req);
        res.status(500).json({ error: "Database error" });
    } finally {
        conn.release();
    }
});

// DELETE a draft outright. The 409 on creating a second draft tells the author
// to "publish or discard it" - this is the discard, which did not exist.
router.delete("/instruments/version/:id", requirePerm('instrument.author'), async (req, res) => {
    try {
        const [[iv]] = await db.query(
            `SELECT instrument_version_id, sector_code, version_no, status
               FROM instrument_version WHERE instrument_version_id=?`, [req.params.id]);
        if (!iv) return res.status(404).json({ error: "That version does not exist" });
        if (iv.status !== 'draft') {
            return res.status(400).json({
                error: "NOT_A_DRAFT",
                message: "Only a draft can be discarded. A published version is kept for the record.",
            });
        }
        // question rows go with it: fk_q_iv is ON DELETE CASCADE.
        await db.query(`DELETE FROM instrument_version WHERE instrument_version_id=?`, [req.params.id]);
        await audit(req, {
            action: 'instrument.draft_discarded', entity: 'instrument_version',
            entityId: iv.instrument_version_id,
            before: { sector: iv.sector_code, version: iv.version_no },
        });
        res.json({ success: true });
    } catch (e) {
        logError("draft DELETE", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ============================================ managing the instruments ==
   The dropdown itself. A sector is an instrument, so adding one is adding a
   questionnaire the product can issue - which is why it sits behind
   instrument.publish rather than instrument.author.

   Nothing here deletes a sector that is in use. A supplier classified into it,
   or a version authored against it, means the code is referenced in issued
   documents; disabling hides it from the pickers without breaking those. */

/* ------------------------------ bulk question authoring, by workbook ----- */
/* Thirty control questions typed one at a time is thirty rows of form filling.
   The template carries the same columns the row editor does, so the two ways
   in produce identical questions - the workbook is a faster door, not a
   different one. */

async function templateVars(sectorCode) {
    const [[sec]] = await db.query(
        `SELECT sector_name FROM sector WHERE sector_code = ?`, [sectorCode]);
    const [dimensions] = await db.query(
        `SELECT dimension_code, dimension_name FROM tiering_dimension ORDER BY sort_order`);
    const [domains] = await db.query(
        `SELECT domain_code, domain_name FROM control_domain ORDER BY sort_order`);
    const [standards] = await db.query(
        `SELECT standard_code FROM standard WHERE active = 1 ORDER BY family, standard_code`);
    return {
        sectorName: (sec && sec.sector_name) || sectorCode,
        dimensions, domains,
        standards: standards.map(s => s.standard_code),
    };
}

router.get("/instruments/version/:id/question-template",
    requirePerm('instrument.author'), async (req, res) => {
    try {
        const [[iv]] = await db.query(
            `SELECT instrument_version_id, sector_code, status FROM instrument_version
              WHERE instrument_version_id = ?`, [req.params.id]);
        if (!iv) return res.status(404).json({ error: "That version does not exist" });

        const vars = await templateVars(iv.sector_code);
        const buf = await excel.questionTemplate(vars);
        res.setHeader('Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition',
            `attachment; filename="Questions_${iv.sector_code}_v${req.params.id}.xlsx"`);
        res.send(Buffer.from(buf));
    } catch (e) {
        logError("question-template", e, req);
        res.status(500).json({ error: "Could not build the template" });
    }
});

/* Preview by default, write only when ?commit=1. Nothing lands in the version
   until someone has seen what would land - the same contract the supplier
   intake upload works to. */
router.post("/instruments/version/:id/questions/import",
    requirePerm('instrument.author'), upload.single('file'), async (req, res) => {
    try {
        const [[iv]] = await db.query(
            `SELECT instrument_version_id, sector_code, status FROM instrument_version
              WHERE instrument_version_id = ?`, [req.params.id]);
        if (!iv) return res.status(404).json({ error: "That version does not exist" });
        if (iv.status !== 'draft') return res.status(400).json(FROZEN);
        if (!req.file) return res.status(400).json({ error: "Attach the completed question template" });

        const vars = await templateVars(iv.sector_code);
        let parsed;
        try {
            parsed = await excel.parseQuestionTemplate(req.file.buffer, vars);
        } catch (pe) {
            return res.status(400).json({ error: pe.code || 'UNREADABLE', message: pe.message });
        }

        // A reference already used in this version is a clash, not a duplicate
        // inside the file, and it has to be reported as its own thing.
        const [existing] = await db.query(
            `SELECT q_ref FROM question WHERE instrument_version_id = ?`,
            [iv.instrument_version_id]);
        const taken = new Set(existing.map(r => String(r.q_ref).toUpperCase()));

        const rows = [];
        const problems = parsed.problems.slice();
        parsed.rows.forEach(r => {
            if (taken.has(r.qRef)) {
                problems.push({ ...r, errors: [`${r.qRef} is already in this version`] });
            } else {
                rows.push(r);
            }
        });

        const summary = {
            read: rows.length + problems.length,
            willImport: rows.length,
            rejected: problems.length,
            tiering: rows.filter(r => r.qType === 'tiering').length,
            control: rows.filter(r => r.qType === 'control').length,
        };

        if (String(req.query.commit) !== '1') {
            return res.json({ preview: true, summary, rows, problems });
        }
        if (!rows.length) {
            return res.status(400).json({
                error: "NOTHING_TO_IMPORT",
                message: "Every row in the workbook was rejected. Fix them and upload it again.",
            });
        }

        // Sort order continues from what is already there, per type, so an
        // import into a part-authored version appends rather than interleaves.
        const [[lastT]] = await db.query(
            `SELECT COALESCE(MAX(sort_order),0) AS n FROM question
              WHERE instrument_version_id=? AND q_type='tiering'`, [iv.instrument_version_id]);
        const [[lastC]] = await db.query(
            `SELECT COALESCE(MAX(sort_order),0) AS n FROM question
              WHERE instrument_version_id=? AND q_type='control'`, [iv.instrument_version_id]);
        let sortT = Number(lastT.n);
        let sortC = Number(lastC.n);

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            for (const r of rows) {
                const sort = r.qType === 'tiering' ? (sortT += 10) : (sortC += 10);
                await conn.query(
                    `INSERT INTO question
                       (instrument_version_id, q_type, q_ref, dimension_code, domain_code, q_text,
                        score_1_label, score_2_label, score_3_label, rationale,
                        evidence_required, standards_mapping, tier_applies, sort_order)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [
                        iv.instrument_version_id, r.qType, r.qRef,
                        r.dimensionCode, r.domainCode, r.qText,
                        r.score1, r.score2, r.score3, r.rationale,
                        r.evidenceRequired, r.standardsMapping, r.tierApplies, sort,
                    ]);
            }
            await conn.commit();
        } catch (te) {
            await conn.rollback();
            throw te;
        } finally {
            conn.release();
        }

        await audit(req, {
            action: 'questions.imported', entity: 'instrument_version',
            entityId: iv.instrument_version_id,
            after: { imported: rows.length, tiering: summary.tiering, control: summary.control },
        });
        res.json({ imported: rows.length, summary });
    } catch (e) {
        logError("questions import", e, req);
        res.status(500).json({ error: "Could not import the questions" });
    }
});

router.get("/sectors/manage", requirePerm('instrument.author'), async (_req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT s.sector_code, s.sector_name, s.sector_group, s.sort_order, s.active,
                    (SELECT COUNT(*) FROM instrument_version iv WHERE iv.sector_code = s.sector_code) AS versions,
                    (SELECT COUNT(*) FROM instrument_version iv
                      WHERE iv.sector_code = s.sector_code AND iv.status='published') AS published_versions,
                    (SELECT COUNT(*) FROM third_party tp
                      WHERE tp.sector_code = s.sector_code AND tp.deleted_time IS NULL) AS third_parties,
                    (SELECT COUNT(*) FROM question q
                       JOIN instrument_version iv2
                         ON iv2.instrument_version_id = q.instrument_version_id
                      WHERE iv2.sector_code = s.sector_code) AS questions
               FROM sector s ORDER BY s.sector_group, s.sort_order, s.sector_name`);
        // in_use drives whether Delete is offered at all, the same way dAdmin's
        // option manager marks a value "unused".
        res.json(rows.map(r => ({ ...r, in_use: r.versions > 0 || r.third_parties > 0 })));
    } catch (e) {
        logError("sectors/manage", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/sectors", requirePerm('instrument.publish'), async (req, res) => {
    try {
        const code = String(req.body.sectorCode || "").trim().toUpperCase();
        const name = String(req.body.sectorName || "").trim();
        if (!/^[A-Z0-9]{2,24}$/.test(code)) {
            return res.status(400).json({
                error: "BAD_CODE",
                message: "A code is 2 to 24 characters, letters and digits only. It appears in every document reference.",
            });
        }
        if (!name) return res.status(400).json({ error: "BAD_NAME", message: "The instrument needs a name." });

        const [[dupe]] = await db.query(`SELECT sector_code FROM sector WHERE sector_code=?`, [code]);
        if (dupe) return res.status(409).json({ error: "CODE_TAKEN", message: `${code} already exists.` });

        const [[last]] = await db.query(
            `SELECT COALESCE(MAX(sort_order),0) AS n FROM sector WHERE sector_group=?`,
            [req.body.sectorGroup || 'Other']);
        await db.query(
            `INSERT INTO sector (sector_code, sector_name, sector_group, sort_order, active)
             VALUES (?,?,?,?,1)`,
            [code, name, req.body.sectorGroup || 'Other', Number(last.n) + 10]);

        await audit(req, { action: 'instrument.created', entity: 'sector', entityId: code, after: { name } });
        res.status(201).json({ success: true, sector_code: code });
    } catch (e) {
        logError("sector POST", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.put("/sectors/:code", requirePerm('instrument.publish'), async (req, res) => {
    try {
        const [[sct]] = await db.query(`SELECT * FROM sector WHERE sector_code=?`, [req.params.code]);
        if (!sct) return res.status(404).json({ error: "That instrument does not exist" });

        const name = req.body.sectorName !== undefined
            ? String(req.body.sectorName).trim() : sct.sector_name;
        if (!name) return res.status(400).json({ error: "BAD_NAME", message: "The instrument needs a name." });

        // The code is never editable. It is stamped into issued documents and
        // into every classified supplier row; renaming it would orphan both.
        await db.query(
            `UPDATE sector SET sector_name=?, sector_group=?, sort_order=? WHERE sector_code=?`,
            [name, req.body.sectorGroup || sct.sector_group,
             req.body.sortOrder !== undefined ? Number(req.body.sortOrder) : sct.sort_order,
             req.params.code]);

        await audit(req, {
            action: 'instrument.updated', entity: 'sector', entityId: req.params.code,
            before: { name: sct.sector_name }, after: { name },
        });
        res.json({ success: true });
    } catch (e) {
        logError("sector PUT", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.put("/sectors/:code/active", requirePerm('instrument.publish'), async (req, res) => {
    try {
        const [[sct]] = await db.query(`SELECT * FROM sector WHERE sector_code=?`, [req.params.code]);
        if (!sct) return res.status(404).json({ error: "That instrument does not exist" });

        const active = req.body.active ? 1 : 0;
        // Disabling takes it out of the pickers. Suppliers already classified
        // into it keep their classification and their assessments keep working -
        // this only stops it being chosen again.
        await db.query(`UPDATE sector SET active=? WHERE sector_code=?`, [active, req.params.code]);
        await audit(req, {
            action: active ? 'instrument.enabled' : 'instrument.disabled',
            entity: 'sector', entityId: req.params.code,
        });
        res.json({ success: true });
    } catch (e) {
        logError("sector active", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.delete("/sectors/:code", requirePerm('instrument.publish'), async (req, res) => {
    try {
        const [[sct]] = await db.query(`SELECT * FROM sector WHERE sector_code=?`, [req.params.code]);
        if (!sct) return res.status(404).json({ error: "That instrument does not exist" });

        const [[used]] = await db.query(
            `SELECT
               (SELECT COUNT(*) FROM instrument_version WHERE sector_code=?) AS versions,
               (SELECT COUNT(*) FROM third_party WHERE sector_code=? AND deleted_time IS NULL) AS third_parties`,
            [req.params.code, req.params.code]);
        if (used.versions > 0 || used.third_parties > 0) {
            return res.status(409).json({
                error: "IN_USE",
                message: `${req.params.code} is used by ${used.third_parties} supplier(s) and ${used.versions} version(s). Disable it instead - deleting it would orphan documents already issued.`,
            });
        }

        await db.query(`DELETE FROM sector WHERE sector_code=?`, [req.params.code]);
        await audit(req, {
            action: 'instrument.deleted', entity: 'sector', entityId: req.params.code,
            before: { name: sct.sector_name },
        });
        res.json({ success: true });
    } catch (e) {
        logError("sector DELETE", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ---------------------------------------------- classification rules */
router.get("/classify-rules", requirePerm('instrument.author'), async (_req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT cr.classify_rule_id, cr.sector_code, cr.keyword, cr.weight, cr.active,
                    s.sector_name
               FROM classify_rule cr LEFT JOIN sector s ON s.sector_code = cr.sector_code
              ORDER BY cr.sector_code, cr.keyword`);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/classify-rules", requirePerm('instrument.author'), async (req, res) => {
    try {
        const { sectorCode, keyword, weight } = req.body;
        if (!sectorCode || !keyword) return res.status(400).json({ error: "Sector and keyword are required" });
        const [r] = await db.query(
            `INSERT INTO classify_rule (sector_code, keyword, weight) VALUES (?,?,?)`,
            [sectorCode, String(keyword).toLowerCase().trim(), weight || 10]);
        classify.resetCache();
        await audit(req, {
            action: 'classify_rule.created', entity: 'classify_rule', entityId: r.insertId,
            after: { sectorCode, keyword },
        });
        res.status(201).json({ success: true, classify_rule_id: r.insertId });
    } catch (e) {
        logError("classify rule", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.delete("/classify-rules/:id", requirePerm('instrument.author'), async (req, res) => {
    try {
        await db.query(`DELETE FROM classify_rule WHERE classify_rule_id=?`, [req.params.id]);
        classify.resetCache();
        await audit(req, { action: 'classify_rule.deleted', entity: 'classify_rule', entityId: req.params.id });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Database error" });
    }
});

module.exports = router;
