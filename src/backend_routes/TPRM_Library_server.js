// The question bank. Sectors, standards, instrument versions and their
// questions.
//
// The version freeze is the rule that matters here: a published instrument is
// immutable. To change a question you create a new draft version, edit that,
// and publish it. Assessments already under way stay bound to the version they
// started on, so a report that was issued last quarter still says what it said.

require("dotenv").config({ quiet: true });
const express = require("express");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requirePerm } = require('./utils/tprm_audit');
const classify = require('./utils/tprm_classify');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();

router.use(verifyJWT, tenantScope);

/* ---------------------------------------------------- reference lookups */
router.get("/sectors", async (_req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT s.sector_code, s.sector_name, s.sector_group,
                    (SELECT COUNT(*) FROM instrument_version iv
                      WHERE iv.sector_code = s.sector_code AND iv.status='published') AS published_versions
               FROM sector s WHERE s.active = 1
              ORDER BY s.sector_group, s.sort_order`);
        res.json(rows);
    } catch (e) {
        logError("sectors", e, _req);
        res.status(500).json({ error: "Database error" });
    }
});

router.get("/standards", async (_req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT standard_code, title, family, scope_note FROM standard
              WHERE active = 1 ORDER BY family, standard_code`);
        res.json(rows);
    } catch (e) {
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
        const [[count]] = await conn.query(
            `SELECT COUNT(*) AS n FROM question WHERE instrument_version_id=? AND q_type='control'`,
            [req.params.id]);
        if (Number(count.n) === 0) {
            return res.status(400).json({
                error: "NO_CONTROLS",
                message: "This version has no control questions. Add some before publishing.",
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
router.put("/questions/:id", requirePerm('instrument.author'), async (req, res) => {
    try {
        const [[q]] = await db.query(
            `SELECT q.*, iv.status FROM question q
               JOIN instrument_version iv ON iv.instrument_version_id = q.instrument_version_id
              WHERE q.question_id = ?`, [req.params.id]);
        if (!q) return res.status(404).json({ error: "That question does not exist" });
        if (q.status !== 'draft') {
            return res.status(400).json({
                error: "VERSION_FROZEN",
                message: "Published versions are immutable. Create a draft version to make changes.",
            });
        }

        const { qText, evidenceRequired, standardsMapping, tierApplies } = req.body;
        await db.query(
            `UPDATE question SET
               q_text            = COALESCE(?, q_text),
               evidence_required = COALESCE(?, evidence_required),
               standards_mapping = COALESCE(?, standards_mapping),
               tier_applies      = COALESCE(?, tier_applies)
             WHERE question_id = ?`,
            [qText || null, evidenceRequired || null, standardsMapping || null,
             tierApplies || null, req.params.id]
        );
        await audit(req, {
            action: 'question.updated', entity: 'question', entityId: q.question_id,
            before: { q_text: q.q_text, tier_applies: q.tier_applies },
            after: { qText, tierApplies },
        });
        res.json({ success: true });
    } catch (e) {
        logError("question PUT", e, req);
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
