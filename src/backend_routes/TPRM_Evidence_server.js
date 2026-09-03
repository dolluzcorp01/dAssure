// Evidence is a first class object, not an attachment. Every file carries a
// SHA-256 so we can prove later that the document we scored is the document we
// were given, and an optional expiry date so a lapsed certificate demotes its
// control on its own.

require("dotenv").config({ quiet: true });
const express = require("express");
const multer = require("multer");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requireTenant, requirePerm, permitted } = require('./utils/tprm_audit');
const storage = require('./utils/tprm_storage');
const A = require('./TPRM_Assessments_server');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();
const dadmin = getDBConnection('dadmin').promise();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(verifyJWT, tenantScope);

router.post("/responses/:id/upload", requirePerm('evidence.manage'),
    upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Attach the evidence file" });

        const [[r]] = await db.query(
            `SELECT r.*, a.tenant_id, a.state FROM response r
               JOIN assessment a ON a.assessment_id = r.assessment_id
              WHERE r.response_id = ?`, [req.params.id]);
        if (!r) return res.status(404).json({ error: "That control response does not exist" });
        req.tenantId = Number(r.tenant_id);
        if (!requireTenant(req, res)) return;

        if (['approved', 'issued', 'closed'].includes(r.state)) {
            return res.status(409).json({ error: "FROZEN", message: "This assessment is approved and is read only" });
        }

        const key = storage.keyFor(
            `tenant/${r.tenant_id}/evidence/${r.assessment_id}`, req.file.originalname);
        const put = storage.put(key, req.file.buffer);

        const [ins] = await db.query(
            `INSERT INTO evidence
               (response_id, file_key, original_name, mime_type, byte_size, sha256,
                doc_type, valid_from, expires_at, uploaded_by)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [r.response_id, key, req.file.originalname, req.file.mimetype, req.file.size,
             put.sha256, req.body.docType || null, req.body.validFrom || null,
             req.body.expiresAt || null, req.emp_id]);

        await audit(req, {
            action: 'evidence.uploaded', entity: 'evidence', entityId: ins.insertId,
            after: { control: r.q_ref, file: req.file.originalname, sha256: put.sha256 },
            tenantId: r.tenant_id,
        });
        res.status(201).json({ success: true, evidence_id: ins.insertId, sha256: put.sha256 });
    } catch (e) {
        logError("evidence upload", e, req);
        res.status(500).json({ error: "Could not store that file" });
    }
});

router.get("/responses/:id/list", async (req, res) => {
    try {
        const [[r]] = await db.query(
            `SELECT r.response_id, a.tenant_id FROM response r
               JOIN assessment a ON a.assessment_id = r.assessment_id
              WHERE r.response_id = ?`, [req.params.id]);
        if (!r) return res.status(404).json({ error: "That control response does not exist" });
        req.tenantId = Number(r.tenant_id);
        if (!requireTenant(req, res)) return;

        const [rows] = await db.query(
            `SELECT evidence_id, original_name, mime_type, byte_size, sha256, doc_type,
                    valid_from, expires_at, validated_time, uploaded_by, uploaded_time,
                    CASE WHEN expires_at IS NOT NULL AND expires_at < CURDATE() THEN 1 ELSE 0 END AS expired
               FROM evidence WHERE response_id=? ORDER BY evidence_id DESC`, [req.params.id]);

        const ids = [...new Set(rows.map(x => x.uploaded_by).filter(Boolean))];
        let names = {};
        if (ids.length) {
            const [emps] = await dadmin.query(
                `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name FROM employee WHERE emp_id IN (${ids.map(() => '?').join(',')})`, ids);
            emps.forEach(e => { names[e.emp_id] = e.emp_name; });
        }
        rows.forEach(x => { x.uploaded_by_name = names[x.uploaded_by] || 'Supplier pack'; });
        res.json(rows);
    } catch (e) {
        logError("evidence list", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.get("/:id/download", async (req, res) => {
    try {
        const [[e]] = await db.query(
            `SELECT e.*, a.tenant_id FROM evidence e
               JOIN response r ON r.response_id = e.response_id
               JOIN assessment a ON a.assessment_id = r.assessment_id
              WHERE e.evidence_id = ?`, [req.params.id]);
        if (!e) return res.status(404).json({ error: "That evidence file does not exist" });
        req.tenantId = Number(e.tenant_id);
        if (!requireTenant(req, res)) return;

        const buf = storage.get(e.file_key);
        if (!buf) return res.status(404).json({ error: "The stored file could not be read" });

        await audit(req, {
            action: 'evidence.downloaded', entity: 'evidence', entityId: e.evidence_id,
            tenantId: e.tenant_id,
        });
        res.setHeader('Content-Type', e.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${e.original_name}"`);
        res.send(buf);
    } catch (err) {
        logError("evidence download", err, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* Removing a file that should not be there.
 *
 * Wrong file attached to the wrong control is the ordinary case - somebody
 * uploads the MFA policy against the backup question - and without this the
 * only way out was to leave it and hope the assessor noticed.
 *
 * Refused once the assessment is frozen. An approved or issued assessment was
 * scored on the evidence it held, and a report has gone out citing it; letting
 * that evidence disappear afterwards would make the report unverifiable. To
 * change what a frozen assessment stands on, it goes back for rework first.
 *
 * The row goes and the stored bytes go with it. Keeping the file behind a
 * deleted row would leave supplier material on disk that nothing references
 * and nobody is watching. */
router.delete("/:id", async (req, res) => {
    try {
        const [[e]] = await db.query(
            `SELECT e.*, a.tenant_id, a.state, r.q_ref FROM evidence e
               JOIN response r ON r.response_id = e.response_id
               JOIN assessment a ON a.assessment_id = r.assessment_id
              WHERE e.evidence_id = ?`, [req.params.id]);
        if (!e) return res.status(404).json({ error: "That evidence file does not exist" });
        req.tenantId = Number(e.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'evidence.manage')) return;

        if (['approved', 'issued', 'closed'].includes(e.state)) {
            return res.status(400).json({
                error: "ASSESSMENT_FROZEN",
                message: "This assessment has been approved, and its report cites the evidence "
                    + "it held. Send it back for rework before changing what it stands on.",
            });
        }

        await db.query(`DELETE FROM evidence WHERE evidence_id = ?`, [e.evidence_id]);
        try { storage.remove(e.file_key); } catch (_) {
            // The row is the record. A file left behind is worth logging and
            // not worth failing the request over.
            logError("evidence file remove", _, req);
        }

        await audit(req, {
            action: 'evidence.removed', entity: 'evidence', entityId: e.evidence_id,
            reason: req.body && req.body.reason ? String(req.body.reason).slice(0, 400) : null,
            after: { control: e.q_ref, file: e.original_name },
            tenantId: e.tenant_id,
        });
        res.json({ success: true, removed: e.original_name });
    } catch (err) {
        logError("evidence delete", err, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/:id/validate", async (req, res) => {
    try {
        const [[e]] = await db.query(
            `SELECT e.*, a.tenant_id FROM evidence e
               JOIN response r ON r.response_id = e.response_id
               JOIN assessment a ON a.assessment_id = r.assessment_id
              WHERE e.evidence_id = ?`, [req.params.id]);
        if (!e) return res.status(404).json({ error: "That evidence file does not exist" });
        req.tenantId = Number(e.tenant_id);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'evidence.manage')) return;

        await db.query(
            `UPDATE evidence SET validated_by=?, validated_time=NOW(3) WHERE evidence_id=?`,
            [req.emp_id, e.evidence_id]);
        await audit(req, {
            action: 'evidence.validated', entity: 'evidence', entityId: e.evidence_id,
            tenantId: e.tenant_id,
        });
        res.json({ success: true });
    } catch (err) {
        logError("evidence validate", err, req);
        res.status(500).json({ error: "Database error" });
    }
});

/**
 * Expiry-driven decay. Run this nightly from cron:
 *   curl -X POST -b "dTprm_token=<service token>" \
 *        http://127.0.0.1:4009/api/tprm/evidence/maintenance/expire
 *
 * A certificate that lapsed last week drops its control to Not Evidenced
 * without anyone remembering to check, which is the whole point.
 */
router.post("/maintenance/expire", requirePerm('methodology.edit'), async (req, res) => {
    try {
        const [lapsed] = await db.query(
            `SELECT DISTINCT r.response_id, r.assessment_id, r.q_ref, a.tenant_id
               FROM evidence e
               JOIN response r ON r.response_id = e.response_id
               JOIN assessment a ON a.assessment_id = r.assessment_id
              WHERE e.expires_at IS NOT NULL AND e.expires_at < CURDATE()
                AND a.state IN ('draft','in_progress','on_hold')
                AND r.position <> 'Not Evidenced'
                AND NOT EXISTS (
                    SELECT 1 FROM evidence e2
                     WHERE e2.response_id = r.response_id
                       AND (e2.expires_at IS NULL OR e2.expires_at >= CURDATE()))`);

        for (const r of lapsed) {
            await db.query(
                `UPDATE response SET position='Not Evidenced', control_score=1 WHERE response_id=?`,
                [r.response_id]);
            await db.query(
                `INSERT INTO response_history (response_id, new_position, new_score, reason)
                 VALUES (?, 'Not Evidenced', 1, 'Supporting evidence expired')`, [r.response_id]);
            await A.recompute(r.assessment_id);
        }
        res.json({ success: true, decayed: lapsed.length });
    } catch (e) {
        logError("expire evidence", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

module.exports = router;
