// The assessment itself: tiering, control positions, the submit gate, review
// and approval.
//
// Two rules run through this whole file:
//   1. An unevidenced assertion scores 1, never 2.
//   2. The person who assessed can never be the person who approves.
// Both are also enforced in the database, so a bug here cannot bypass them.

require("dotenv").config({ quiet: true });
const express = require("express");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requireTenant, requirePerm, memberTenantIds, permitted,
        permittedTenantIds } = require('./utils/tprm_audit');
const scoring = require('./utils/tprm_scoring');
const contradiction = require('./utils/tprm_contradiction');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();
const dadmin = getDBConnection('dadmin').promise();

router.use(verifyJWT, tenantScope);

// tenantScope reads the first path segment as a client id, which is correct for
// the routers keyed by client (/:tenantId/list and friends). Here the first
// segment is an ASSESSMENT id, so without this every requirePerm below would be
// checked against whichever client happens to share that number - usually none,
// which is why assign, hold, submit and approve all answered FORBIDDEN to a
// Practice Head who plainly holds the permission.
//
// requirePerm runs before the handler, so the real client has to be resolved
// here rather than inside it.
router.use(async (req, res, next) => {
    const m = /^\/(\d+)(\/|$)/.exec(req.path);
    if (!m) return next();
    try {
        const [[a]] = await db.query(
            `SELECT tenant_id FROM assessment WHERE assessment_id = ?`, [m[1]]);
        if (a) req.tenantId = Number(a.tenant_id);
        next();
    } catch (e) {
        logError('assessment tenant resolve', e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ---------------------------------------------------------- internals */

async function loadAssessment(id) {
    const [[a]] = await db.query(
        `SELECT a.*, tp.third_party_name, tp.ref_code, tp.sector_code, tp.security_contact,
                tp.service_desc, s.sector_name, t.tenant_name, t.tenant_code
           FROM assessment a
           JOIN third_party tp ON tp.third_party_id = a.third_party_id
           JOIN tenant t ON t.tenant_id = a.tenant_id
           LEFT JOIN sector s ON s.sector_code = tp.sector_code
          WHERE a.assessment_id = ?`, [id]);
    return a || null;
}

async function methodology(tenantId) {
    const [[m]] = await db.query(`SELECT * FROM tenant_methodology WHERE tenant_id=?`, [tenantId]);
    return {
        weights: scoring.jsonOf(m && m.dimension_weights, scoring.DEFAULT_DIMENSION_WEIGHTS),
        domainWeights: scoring.jsonOf(m && m.domain_weights, {}),
        t1: m ? Number(m.tier1_threshold) : scoring.DEFAULT_TIER1,
        t2: m ? Number(m.tier2_threshold) : scoring.DEFAULT_TIER2,
        sla: scoring.jsonOf(m && m.sla_json, scoring.DEFAULT_SLA),
    };
}

/** Recompute inherent, tier, effectiveness and residual from the live answers. */
async function recompute(assessmentId) {
    const a = await loadAssessment(assessmentId);
    if (!a) return null;
    const m = await methodology(a.tenant_id);

    const [tierAns] = await db.query(
        `SELECT r.tiering_score, q.dimension_code
           FROM response r
           JOIN question q ON q.instrument_version_id = ? AND q.q_ref = r.q_ref
          WHERE r.assessment_id = ? AND r.q_type='tiering' AND r.tiering_score IS NOT NULL`,
        [a.instrument_version_id, assessmentId]);
    const inherent = scoring.inherentScore(tierAns, m.weights);
    const tier = scoring.tierFor(inherent, m.t1, m.t2);

    const [ctrl] = await db.query(
        `SELECT r.position, q.domain_code
           FROM response r
           JOIN question q ON q.instrument_version_id = ? AND q.q_ref = r.q_ref
          WHERE r.assessment_id = ? AND r.q_type='control' AND r.position IS NOT NULL`,
        [a.instrument_version_id, assessmentId]);
    const eff = scoring.effectiveness(ctrl, m.domainWeights);
    const resid = scoring.residual(inherent, eff);
    const band = scoring.residualBand(resid);

    await db.query(
        `UPDATE assessment SET inherent_score=?, tier=?, effectiveness=?, residual_score=?, residual_band=?
          WHERE assessment_id=?`,
        [inherent, tier, eff, resid, band, assessmentId]);

    return { inherent, tier, effectiveness: eff, residual: resid, band };
}

function editableOr(a, res) {
    if (['approved', 'issued', 'closed'].includes(a.state)) {
        res.status(409).json({
            error: "FROZEN",
            message: "This assessment is approved and is read only. A change requires a new assessment cycle.",
        });
        return false;
    }
    if (a.state === 'under_review') {
        res.status(409).json({ error: "UNDER_REVIEW", message: "This assessment is with the reviewer and cannot be edited" });
        return false;
    }
    if (a.state === 'on_hold') {
        res.status(409).json({ error: "ON_HOLD", message: "This case is on hold. Resume it before editing." });
        return false;
    }
    return true;
}

async function addActivity(assessmentId, text) {
    await db.query(
        `INSERT INTO case_message (assessment_id, msg_kind, body) VALUES (?, 'activity', ?)`,
        [assessmentId, text]);
}

/** The submit gate. Every check must pass before an assessment leaves the
 *  assessor's hands. Returned as a list so the UI can show what is missing. */
async function submitChecks(a) {
    const [[pending]] = await db.query(
        `SELECT COUNT(*) AS n FROM response
          WHERE assessment_id=? AND q_type='control' AND vendor_asserted=1`, [a.assessment_id]);
    const [[total]] = await db.query(
        `SELECT COUNT(*) AS n FROM question
          WHERE instrument_version_id=? AND q_type='control' AND tier_applies >= ?`,
        [a.instrument_version_id, a.tier || 3]);
    const [[answered]] = await db.query(
        `SELECT COUNT(*) AS n FROM response
          WHERE assessment_id=? AND q_type='control' AND position IS NOT NULL`, [a.assessment_id]);
    const [[openFlags]] = await db.query(
        `SELECT COUNT(*) AS n FROM contradiction_flag WHERE assessment_id=? AND state='open'`, [a.assessment_id]);
    const [[findings]] = await db.query(
        `SELECT COUNT(*) AS n FROM finding WHERE assessment_id=?`, [a.assessment_id]);
    const [[gaps]] = await db.query(
        `SELECT COUNT(*) AS n FROM response
          WHERE assessment_id=? AND q_type='control'
            AND position IN ('Non-Compliant','Not Evidenced','Partially Compliant')`, [a.assessment_id]);

    const reviewerOk = !!a.reviewer_id && String(a.reviewer_id) !== String(a.assessor_id);

    return [
        {
            key: 'tiered', label: 'Inherent risk tiering is complete',
            pass: a.tier !== null && a.tier !== undefined,
            detail: a.tier ? `Tier ${a.tier} on an inherent score of ${a.inherent_score}` : 'No tiering answers recorded yet',
        },
        {
            key: 'all_answered', label: 'Every control in scope has a recorded position',
            pass: Number(answered.n) >= Number(total.n) && Number(total.n) > 0,
            detail: `${answered.n} of ${total.n} controls answered`,
        },
        {
            key: 'none_asserted', label: 'No control is left as an unaccepted supplier assertion',
            pass: Number(pending.n) === 0,
            detail: `${pending.n} controls are still supplier assertions awaiting your decision`,
        },
        {
            key: 'contradictions', label: 'Contradictions escalated or resolved',
            pass: Number(openFlags.n) === 0,
            detail: `${openFlags.n} open contradictions must be actioned first`,
        },
        {
            key: 'findings', label: 'Findings raised from non conformant positions',
            pass: Number(gaps.n) === 0 || Number(findings.n) > 0,
            detail: `${findings.n} findings raised against ${gaps.n} non conformant positions`,
        },
        {
            key: 'reviewer', label: 'Reviewer assigned and is not the assessor',
            pass: reviewerOk,
            detail: reviewerOk ? 'Reviewer assigned' : 'Assign a reviewer who is not the assessor',
        },
    ];
}

/* ------------------------------------------------ create an assessment */
router.post("/third-parties/:id/create", requirePerm('assessment.assign'), async (req, res) => {
    try {
        const [[tp]] = await db.query(`SELECT * FROM third_party WHERE third_party_id=?`, [req.params.id]);
        if (!tp) return res.status(404).json({ error: "That supplier does not exist" });
        req.tenantId = Number(tp.tenant_id);
        if (!requireTenant(req, res)) return;

        const { assessorId, reviewerId, cycleLabel } = req.body;
        if (assessorId && reviewerId && String(assessorId) === String(reviewerId)) {
            return res.status(400).json({
                error: "SOD_VIOLATION",
                message: "The reviewer cannot be the same person as the assessor",
            });
        }

        const [[triage]] = await db.query(
            `SELECT in_scope FROM triage_decision WHERE third_party_id=?`, [tp.third_party_id]);
        if (triage && Number(triage.in_scope) === 0) {
            return res.status(409).json({
                error: "OUT_OF_SCOPE",
                message: "This supplier was descoped at triage. Bring it back in scope before assessing.",
            });
        }

        const [[iv]] = await db.query(
            `SELECT instrument_version_id FROM instrument_version
              WHERE sector_code=? AND status='published' ORDER BY version_no DESC LIMIT 1`,
            [tp.sector_code]);
        if (!iv) {
            return res.status(409).json({
                error: "NO_PUBLISHED_INSTRUMENT",
                message: `No published questionnaire exists for ${tp.sector_code}. Publish one in the Question Bank before assessing.`,
            });
        }

        const [r] = await db.query(
            `INSERT INTO assessment
               (tenant_id, third_party_id, instrument_version_id, cycle_label,
                assessor_id, reviewer_id, created_by)
             VALUES (?,?,?,?,?,?,?)`,
            [tp.tenant_id, tp.third_party_id, iv.instrument_version_id, cycleLabel || null,
             assessorId || null, reviewerId || null, req.emp_id]);

        await addActivity(r.insertId, 'Assessment opened');
        await audit(req, {
            action: 'assessment.created', entity: 'assessment', entityId: r.insertId,
            tenantId: tp.tenant_id,
        });
        res.status(201).json({
            success: true, assessment_id: r.insertId,
            instrument_version_id: iv.instrument_version_id,
        });
    } catch (e) {
        // The database SoD trigger surfaces here if the API check is ever bypassed
        if (e.sqlState === '45000') return res.status(400).json({ error: "SOD_VIOLATION", message: e.sqlMessage });
        logError("create assessment", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------------------------------- list my assessments */
router.get("/list", async (req, res) => {
    try {
        /* Membership is not the question here - a Client Viewer belongs to a
           client and still has no business reading its assessments. Scoped to
           the clients where the caller holds the work, so an empty list is the
           honest answer rather than someone else's caseload. */
        const ids = permittedTenantIds(req, ['assessment.perform', 'vendor.manage']);
        if (!ids.length) return res.json([]);
        const mine = req.query.mine === '1';

        const [rows] = await db.query(
            `SELECT a.assessment_id, a.state, a.tier, a.inherent_score, a.effectiveness,
                    a.residual_score, a.residual_band, a.assessor_id, a.reviewer_id,
                    a.created_time, a.cycle_label,
                    tp.third_party_name, tp.ref_code, s.sector_name, t.tenant_name, t.tenant_id,
                    (SELECT COUNT(*) FROM response r
                      WHERE r.assessment_id=a.assessment_id AND r.q_type='control'
                        AND r.position IS NOT NULL) AS answered,
                    (SELECT COUNT(*) FROM response r
                      WHERE r.assessment_id=a.assessment_id AND r.vendor_asserted=1) AS pending_assertions,
                    (SELECT COUNT(*) FROM finding f
                      WHERE f.assessment_id=a.assessment_id
                        AND f.status IN ('open','in_progress')) AS open_findings
               FROM assessment a
               JOIN third_party tp ON tp.third_party_id = a.third_party_id
               JOIN tenant t ON t.tenant_id = a.tenant_id
               LEFT JOIN sector s ON s.sector_code = tp.sector_code
              WHERE a.tenant_id IN (${ids.map(() => '?').join(',')})
                ${mine ? 'AND a.assessor_id = ?' : ''}
              ORDER BY a.assessment_id DESC`,
            mine ? [...ids, req.emp_id] : ids);
        res.json(rows);
    } catch (e) {
        logError("assessments list", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ----------------------------------------------- the full case view */
/* Reading a case is assessment work. It carries every position, every
   assessor note and every override justification, so it is gated on the same
   permission as recording one rather than on membership alone. */
router.get("/:id", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'assessment.perform')) return;

        const [questions] = await db.query(
            `SELECT q.q_ref, q.q_type, q.q_text, q.dimension_code, q.domain_code, q.evidence_required,
                    q.standards_mapping, q.tier_applies, q.score_1_label, q.score_2_label, q.score_3_label,
                    q.sort_order, cd.domain_name, cd.sort_order AS domain_order, td.dimension_name
               FROM question q
               LEFT JOIN control_domain cd ON cd.domain_code = q.domain_code
               LEFT JOIN tiering_dimension td ON td.dimension_code = q.dimension_code
              WHERE q.instrument_version_id = ?
              ORDER BY q.q_type DESC, cd.sort_order, q.sort_order, q.q_ref`,
            [a.instrument_version_id]);

        const [responses] = await db.query(
            `SELECT r.*, (SELECT COUNT(*) FROM evidence e WHERE e.response_id = r.response_id) AS evidence_count
               FROM response r WHERE r.assessment_id = ?`, [a.assessment_id]);

        const [flags] = await db.query(
            `SELECT * FROM contradiction_flag WHERE assessment_id=? ORDER BY flag_id`, [a.assessment_id]);
        const [findings] = await db.query(
            `SELECT * FROM finding WHERE assessment_id=?
              ORDER BY FIELD(severity,'Critical','High','Medium','Low'), finding_id`, [a.assessment_id]);
        const [messages] = await db.query(
            `SELECT * FROM case_message WHERE assessment_id=? AND deleted_time IS NULL
              ORDER BY created_time`, [a.assessment_id]);

        // Attach author names to comments from the shared employee table
        const authorIds = [...new Set(messages.map(m => m.author_id).filter(Boolean))];
        let names = {};
        if (authorIds.length) {
            const [emps] = await dadmin.query(
                `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name FROM employee
                  WHERE emp_id IN (${authorIds.map(() => '?').join(',')})`, authorIds);
            emps.forEach(e => { names[e.emp_id] = e.emp_name; });
        }
        messages.forEach(m => { m.author_name = m.author_id ? (names[m.author_id] || 'Unknown') : null; });

        const controlsInScope = questions.filter(q =>
            q.q_type === 'control' && (!a.tier || scoring.inScopeForTier(q.tier_applies, a.tier))).length;

        res.json({
            assessment: a, questions, controlsInScope, responses, flags, findings, messages,
            canApprove: !!(req.grants[a.tenant_id] && req.grants[a.tenant_id].perms.has('assessment.approve')),
            isAssessor: String(a.assessor_id) === String(req.emp_id),
        });
    } catch (e) {
        logError("assessment view", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* -------------------------------------------------- record tiering */
router.post("/:id/tiering", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'assessment.perform')) return;
        if (!editableOr(a, res)) return;

        const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
        if (!answers.length) return res.status(400).json({ error: "No tiering answers were sent" });

        for (const ans of answers) {
            const score = Number(ans.score);
            if (![1, 2, 3].includes(score)) {
                return res.status(400).json({ error: `Score for ${ans.qRef} must be 1, 2 or 3` });
            }
            await db.query(
                `INSERT INTO response (assessment_id, q_ref, q_type, tiering_score, answered_by, answered_time)
                 VALUES (?,?,'tiering',?,?,NOW(3))
                 ON DUPLICATE KEY UPDATE tiering_score=VALUES(tiering_score),
                   answered_by=VALUES(answered_by), answered_time=NOW(3)`,
                [a.assessment_id, ans.qRef, score, req.emp_id]);
        }

        if (a.state === 'draft') {
            await db.query(`UPDATE assessment SET state='in_progress' WHERE assessment_id=?`, [a.assessment_id]);
        }
        const out = await recompute(a.assessment_id);
        await audit(req, {
            action: 'tiering.recorded', entity: 'assessment', entityId: a.assessment_id,
            after: { answers: answers.length, ...out }, tenantId: a.tenant_id,
        });
        res.json({ success: true, ...out });
    } catch (e) {
        logError("tiering", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ----------------------------------- record one control position */
router.post("/:id/responses", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'assessment.perform')) return;
        if (!editableOr(a, res)) return;

        const { qRef, position, note, override, justification } = req.body;
        if (!scoring.POSITIONS.includes(position)) {
            return res.status(400).json({ error: `"${position}" is not one of the five allowed positions` });
        }

        const [[prev]] = await db.query(
            `SELECT * FROM response WHERE assessment_id=? AND q_ref=?`, [a.assessment_id, qRef]);

        // An override cannot be saved silently. This is the record an auditor
        // reads when they ask why a supplier's own answer was changed.
        if (override) {
            // Recording a position and overturning one are different acts, so
            // they are different permissions. An Assessor records; correcting
            // their reading of a supplier's answer belongs to the roles their
            // work is reviewed by.
            if (!permitted(req, res, 'response.override')) return;
            if (!justification || String(justification).trim().length < 15) {
                return res.status(400).json({
                    error: "JUSTIFICATION_REQUIRED",
                    message: "An override needs at least 15 characters of written justification. "
                        + "An override with no reason is not an assessment, it is an opinion.",
                });
            }
            if (prev && prev.position === position) {
                return res.status(400).json({ error: "NO_CHANGE", message: "An override has to change the position" });
            }
        }

        await db.query(
            `INSERT INTO response
               (assessment_id, q_ref, q_type, position, control_score, assessor_note,
                vendor_asserted, is_override, override_reason, override_by, answered_by, answered_time)
             VALUES (?,?,'control',?,?,?,0,?,?,?,?,NOW(3))
             ON DUPLICATE KEY UPDATE position=VALUES(position), control_score=VALUES(control_score),
               assessor_note=VALUES(assessor_note), vendor_asserted=0,
               is_override=VALUES(is_override), override_reason=VALUES(override_reason),
               override_by=VALUES(override_by), answered_by=VALUES(answered_by), answered_time=NOW(3)`,
            [a.assessment_id, qRef, position, scoring.POSITION_SCORE[position], note || null,
             override ? 1 : 0, override ? justification : null, override ? req.emp_id : null, req.emp_id]);

        const [[now]] = await db.query(
            `SELECT response_id FROM response WHERE assessment_id=? AND q_ref=?`, [a.assessment_id, qRef]);
        await db.query(
            `INSERT INTO response_history
               (response_id, old_position, new_position, old_score, new_score, reason, changed_by)
             VALUES (?,?,?,?,?,?,?)`,
            [now.response_id, prev ? prev.position : null, position,
             prev ? prev.control_score : null, scoring.POSITION_SCORE[position],
             override ? justification : (note || null), req.emp_id]);

        await contradiction.refresh(a.assessment_id, a.instrument_version_id);
        const out = await recompute(a.assessment_id);

        await audit(req, {
            action: override ? 'response.overridden' : 'response.recorded',
            entity: 'response', entityId: now.response_id,
            before: prev ? { position: prev.position } : null,
            after: { position },
            reason: justification || null, tenantId: a.tenant_id,
        });
        res.json({ success: true, ...out });
    } catch (e) {
        logError("response", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------- accept a whole control area in one click */
// Only rows that arrived with evidence attached can be accepted in bulk.
// Anything without evidence has to be looked at individually, which is the
// entire point of the model: the assessor's time goes where the proof is
// missing, not where it is present.
router.post("/:id/accept-area", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'assessment.perform')) return;
        if (!editableOr(a, res)) return;

        const { domainCode } = req.body;
        const [rows] = await db.query(
            `SELECT r.response_id, r.q_ref FROM response r
               JOIN question q ON q.instrument_version_id=? AND q.q_ref=r.q_ref
              WHERE r.assessment_id=? AND r.q_type='control' AND q.domain_code=?
                AND r.vendor_asserted=1
                AND EXISTS (SELECT 1 FROM evidence e WHERE e.response_id = r.response_id)`,
            [a.instrument_version_id, a.assessment_id, domainCode]);

        if (!rows.length) {
            return res.status(400).json({
                error: "NOTHING_TO_ACCEPT",
                message: "No supplier assertions with evidence attached are outstanding in that control area.",
            });
        }

        await db.query(
            `UPDATE response SET vendor_asserted=0, answered_by=?, answered_time=NOW(3)
              WHERE response_id IN (${rows.map(() => '?').join(',')})`,
            [req.emp_id, ...rows.map(r => r.response_id)]);

        const out = await recompute(a.assessment_id);
        await audit(req, {
            action: 'assessment.area_accepted', entity: 'assessment', entityId: a.assessment_id,
            after: { domain: domainCode, accepted: rows.length }, tenantId: a.tenant_id,
        });
        res.json({ success: true, accepted: rows.length, ...out });
    } catch (e) {
        logError("accept-area", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------------------------- assign assessor / reviewer */
router.put("/:id/assign", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'assessment.assign')) return;

        const assessorId = req.body.assessorId || null;
        const reviewerId = req.body.reviewerId || null;
        if (assessorId && reviewerId && String(assessorId) === String(reviewerId)) {
            return res.status(400).json({
                error: "SOD_VIOLATION",
                message: "The reviewer cannot be the same person as the assessor",
            });
        }
        await db.query(
            `UPDATE assessment SET assessor_id=?, reviewer_id=? WHERE assessment_id=?`,
            [assessorId, reviewerId, a.assessment_id]);
        await audit(req, {
            action: 'assessment.assigned', entity: 'assessment', entityId: a.assessment_id,
            before: { assessor: a.assessor_id, reviewer: a.reviewer_id },
            after: { assessor: assessorId, reviewer: reviewerId }, tenantId: a.tenant_id,
        });
        res.json({ success: true });
    } catch (e) {
        if (e.sqlState === '45000') return res.status(400).json({ error: "SOD_VIOLATION", message: e.sqlMessage });
        logError("assign", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* --------------------------------------------------- hold and resume */
router.post("/:id/hold", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'assessment.hold')) return;

        const { hold, reason } = req.body;
        if (hold) {
            if (a.state !== 'in_progress') {
                return res.status(409).json({ error: "BAD_STATE", message: "Only an assessment in progress can be put on hold" });
            }
            if (!reason) return res.status(400).json({ error: "REASON_REQUIRED", message: "Say why the case is going on hold" });
            await db.query(
                `UPDATE assessment SET state='on_hold', hold_reason=?, held_time=NOW(3) WHERE assessment_id=?`,
                [reason, a.assessment_id]);
        } else {
            if (a.state !== 'on_hold') {
                return res.status(409).json({ error: "BAD_STATE", message: "That assessment is not on hold" });
            }
            // SLA clocks stop while a case is held, so a client-side pause
            // never counts against our own remediation figures.
            await db.query(
                `UPDATE assessment SET state='in_progress', hold_reason=NULL,
                        hold_elapsed_sec = hold_elapsed_sec + TIMESTAMPDIFF(SECOND, held_time, NOW(3)),
                        held_time=NULL WHERE assessment_id=?`, [a.assessment_id]);
            await db.query(
                `UPDATE finding SET sla_paused_sec = sla_paused_sec + TIMESTAMPDIFF(SECOND, ?, NOW(3))
                  WHERE assessment_id=? AND status IN ('open','in_progress')`,
                [a.held_time, a.assessment_id]);
        }

        await addActivity(a.assessment_id,
            hold ? `Case placed on hold. ${reason}` : 'Case resumed. SLA clocks restarted.');
        await audit(req, {
            action: hold ? 'assessment.held' : 'assessment.resumed',
            entity: 'assessment', entityId: a.assessment_id, reason: reason || null, tenantId: a.tenant_id,
        });
        res.json({ success: true });
    } catch (e) {
        logError("hold", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ---------------------------------------------- the submit gate */
router.get("/:id/submit-check", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'assessment.perform')) return;
        res.json(await submitChecks(a));
    } catch (e) {
        logError("submit-check", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/:id/submit", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'assessment.perform')) return;

        if (a.state !== 'in_progress') {
            return res.status(409).json({ error: "BAD_STATE", message: "Only an assessment in progress can be submitted" });
        }
        const checks = await submitChecks(a);
        const failed = checks.filter(c => !c.pass);
        if (failed.length) {
            return res.status(400).json({
                error: "GATE_FAILED",
                message: "This assessment cannot be submitted yet",
                details: failed.map(c => ({ field: c.key, message: c.detail })),
            });
        }

        await db.query(
            `UPDATE assessment SET state='under_review', submitted_time=NOW(3) WHERE assessment_id=?`,
            [a.assessment_id]);
        await addActivity(a.assessment_id, 'Submitted for review');
        await audit(req, {
            action: 'assessment.submitted', entity: 'assessment', entityId: a.assessment_id,
            tenantId: a.tenant_id,
        });
        res.json({ success: true });
    } catch (e) {
        logError("submit", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/:id/send-back", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'assessment.approve')) return;

        if (a.state !== 'under_review') {
            return res.status(409).json({ error: "BAD_STATE", message: "That assessment is not under review" });
        }
        if (String(a.assessor_id) === String(req.emp_id)) {
            return res.status(403).json({ error: "SOD_VIOLATION", message: "You cannot review your own assessment" });
        }
        const { refs, reason } = req.body;
        if (!reason || String(reason).trim().length < 10) {
            return res.status(400).json({ error: "REASON_REQUIRED", message: "Say what needs reworking, in at least 10 characters" });
        }

        await db.query(`UPDATE assessment SET state='in_progress' WHERE assessment_id=?`, [a.assessment_id]);
        await addActivity(a.assessment_id,
            `Sent back for rework${refs && refs.length ? ' on ' + refs.join(', ') : ''}. ${reason}`);
        await audit(req, {
            action: 'assessment.sent_back', entity: 'assessment', entityId: a.assessment_id,
            after: { refs }, reason, tenantId: a.tenant_id,
        });
        res.json({ success: true });
    } catch (e) {
        logError("send-back", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/:id/approve", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'assessment.approve')) return;

        if (a.state !== 'under_review') {
            return res.status(409).json({ error: "BAD_STATE", message: "That assessment is not under review" });
        }
        // The rule that makes the whole thing worth anything. Checked here, and
        // again by the database trigger below when reviewer_id is written.
        if (String(a.assessor_id) === String(req.emp_id)) {
            return res.status(403).json({ error: "SOD_VIOLATION", message: "You cannot approve your own assessment" });
        }

        const out = await recompute(a.assessment_id);
        await db.query(
            `UPDATE assessment SET state='approved', approved_time=NOW(3), reviewer_id=? WHERE assessment_id=?`,
            [req.emp_id, a.assessment_id]);
        await addActivity(a.assessment_id,
            'Approved. Positions, scores and finding severities are now frozen.');
        await audit(req, {
            action: 'assessment.approved', entity: 'assessment', entityId: a.assessment_id,
            after: out, tenantId: a.tenant_id,
        });
        res.json({ success: true, ...out });
    } catch (e) {
        if (e.sqlState === '45000') return res.status(400).json({ error: "SOD_VIOLATION", message: e.sqlMessage });
        logError("approve", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* --------------------------------------- raise findings from the gaps */
router.post("/:id/raise-findings", async (req, res) => {
    const conn = await db.getConnection();
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'finding.manage')) return;
        if (!editableOr(a, res)) return;

        const m = await methodology(a.tenant_id);
        const [rows] = await db.query(
            `SELECT r.q_ref, r.position, r.assessor_note, q.domain_code, q.q_text, q.evidence_required
               FROM response r
               JOIN question q ON q.instrument_version_id=? AND q.q_ref=r.q_ref
              WHERE r.assessment_id=? AND r.q_type='control'
                AND r.position IN ('Non-Compliant','Not Evidenced','Partially Compliant')
              ORDER BY q.domain_code, r.q_ref`,
            [a.instrument_version_id, a.assessment_id]);

        await conn.beginTransaction();

        // One SELECT ... FOR UPDATE outside the loop. Doing it per row would
        // race two assessors onto the same finding reference.
        const [[seq]] = await conn.query(
            `SELECT COALESCE(MAX(CAST(SUBSTRING(finding_ref, 3) AS UNSIGNED)), 0) AS mx
               FROM finding WHERE tenant_id=? FOR UPDATE`, [a.tenant_id]);
        let next = Number(seq.mx) + 1;

        let created = 0;
        for (const r of rows) {
            const sev = scoring.severityFor(r.position, a.tier || 2);
            if (!sev) continue;
            const [[exists]] = await conn.query(
                `SELECT finding_id FROM finding WHERE assessment_id=? AND control_ref=?`,
                [a.assessment_id, r.q_ref]);
            if (exists) continue;

            const ref = `F-${String(a.tenant_id).padStart(2, '0')}${String(next++).padStart(4, '0')}`;
            const days = m.sla[sev] || 30;
            const detail = [
                `Position recorded: ${r.position}.`,
                r.evidence_required ? `Evidence expected: ${r.evidence_required}.` : null,
                r.assessor_note ? `Assessor note: ${r.assessor_note}` : null,
            ].filter(Boolean).join('\n');

            await conn.query(
                `INSERT INTO finding
                   (tenant_id, assessment_id, finding_ref, control_ref, domain_code, title, detail,
                    severity, raised_by, raised_at, due_at)
                 VALUES (?,?,?,?,?,?,?,?,?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY))`,
                [a.tenant_id, a.assessment_id, ref, r.q_ref, r.domain_code,
                 `${r.position}: ${String(r.q_text).slice(0, 300)}`, detail, sev, req.emp_id, days]);
            created++;
        }
        await conn.commit();

        await audit(req, {
            action: 'findings.raised', entity: 'assessment', entityId: a.assessment_id,
            after: { created }, tenantId: a.tenant_id,
        });
        res.json({ success: true, created });
    } catch (e) {
        await conn.rollback().catch(() => {});
        logError("raise-findings", e, req);
        res.status(500).json({ error: "Database error" });
    } finally {
        conn.release();
    }
});

/* --------------------------------------------------- case comments */
router.post("/:id/messages", async (req, res) => {
    try {
        const a = await loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'case.comment')) return;

        const { body, contextRef } = req.body;
        if (!body || !String(body).trim()) return res.status(400).json({ error: "Write something first" });

        const [r] = await db.query(
            `INSERT INTO case_message (assessment_id, msg_kind, author_id, body, context_ref)
             VALUES (?, 'comment', ?, ?, ?)`,
            [a.assessment_id, req.emp_id, String(body).trim(), contextRef || null]);
        res.status(201).json({ success: true, message_id: r.insertId });
    } catch (e) {
        logError("comment", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

module.exports = router;
module.exports.recompute = recompute;
module.exports.loadAssessment = loadAssessment;
module.exports.methodology = methodology;
