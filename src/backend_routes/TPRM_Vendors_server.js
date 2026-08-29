// The supplier population pipeline:
//   intake template  →  upload + preview  →  commit  →  classify  →  triage
//
// Nothing is written to the register on preview. The whole file, valid rows
// and rejected rows alike, is parked in intake_batch / intake_row so the
// import can always be explained or replayed, and so the client can be sent a
// precise list of what to fix.

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requireTenant, requirePerm } = require('./utils/tprm_audit');
const excel = require('./utils/tprm_excel');
const classify = require('./utils/tprm_classify');
const storage = require('./utils/tprm_storage');
const mailer = require('./utils/tprm_mailer');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(verifyJWT, tenantScope);

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ------------------------------------------------ 1. the intake template */
router.get("/:tenantId/intake-template", requirePerm('vendor.manage'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [[t]] = await db.query(`SELECT tenant_name FROM tenant WHERE tenant_id=?`, [req.tenantId]);
        const buf = await excel.intakeTemplate({
            tenantName: t.tenant_name, businessUnit: req.query.unit || null,
        });
        await audit(req, {
            action: 'intake.template_downloaded', entity: 'tenant',
            entityId: req.tenantId, tenantId: req.tenantId,
        });
        res.setHeader('Content-Type', XLSX_MIME);
        res.setHeader('Content-Disposition',
            `attachment; filename="Supplier_Intake_Template_${t.tenant_name.replace(/\W+/g, '_')}.xlsx"`);
        res.send(Buffer.from(buf));
    } catch (e) {
        logError("intake-template", e, req);
        res.status(500).json({ error: "Could not build the template" });
    }
});

router.post("/:tenantId/intake-template/email", requirePerm('vendor.manage'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const { to, businessUnit } = req.body;
        if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
            return res.status(400).json({ error: "A valid recipient email is required" });
        }

        const [[t]] = await db.query(`SELECT tenant_name FROM tenant WHERE tenant_id=?`, [req.tenantId]);
        const buf = await excel.intakeTemplate({ tenantName: t.tenant_name, businessUnit });
        const key = storage.keyFor(`tenant/${req.tenantId}/intake`, 'Supplier_Intake_Template.xlsx');
        storage.put(key, Buffer.from(buf));

        const tpl = mailer.templates.intakeTemplate({ tenantName: t.tenant_name, businessUnit });
        await mailer.queue({
            tenantId: req.tenantId, to, subject: tpl.subject, body: tpl.body,
            attachmentKey: key, attachmentName: 'Supplier_Intake_Template.xlsx',
            kind: 'intake_template', empId: req.emp_id,
        });
        await audit(req, {
            action: 'intake.template_emailed', entity: 'tenant', entityId: req.tenantId,
            after: { to }, tenantId: req.tenantId,
        });
        res.json({ success: true, message: `Template queued for ${to}` });
    } catch (e) {
        logError("intake email", e, req);
        res.status(500).json({ error: "Could not queue the template" });
    }
});

/* ---------------------------------- 2. upload a completed list, preview */
router.post("/:tenantId/intake/preview", requirePerm('vendor.manage'),
    upload.single('file'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;
        if (!req.file) return res.status(400).json({ error: "Attach the completed intake workbook" });

        let parsed;
        try { parsed = await excel.parseIntake(req.file.buffer); }
        catch (e) { return res.status(400).json({ error: e.code || 'FILE_UNREADABLE', message: e.message }); }

        if (parsed.missing.length) {
            return res.status(400).json({
                error: "COLUMNS_MISSING",
                message: "Required columns were not found in that file",
                details: parsed.missing.map(k => ({ field: k, message: `The "${k}" column is required and was not found` })),
            });
        }

        // Duplicates against what is already in the register, not just within
        // the file. Re-uploading last quarter's list should not double it.
        const names = parsed.rows.map(r => r.vendor_name).filter(Boolean);
        let already = new Set();
        if (names.length) {
            const [existing] = await db.query(
                `SELECT third_party_name FROM third_party
                  WHERE tenant_id=? AND deleted_time IS NULL
                    AND third_party_name IN (${names.map(() => '?').join(',')})`,
                [req.tenantId, ...names]);
            already = new Set(existing.map(e => e.third_party_name.toLowerCase()));
        }

        for (const r of parsed.rows) {
            if (r.vendor_name && already.has(r.vendor_name.toLowerCase())) {
                r.errors.push({
                    code: 'ALREADY_IN_REGISTER', field: 'vendor_name',
                    message: 'This supplier is already in the register',
                });
            }
            const s = await classify.suggest({
                vendorName: r.vendor_name, serviceDesc: r.service_desc, spendCategory: r.spend_category,
            });
            r.suggested_sector = s.sector;
            r.confidence = s.confidence;
            r.matched = s.matched;
        }

        const valid = parsed.rows.filter(r => !r.errors.length);
        const rejected = parsed.rows.filter(r => r.errors.length);

        const conn = await db.getConnection();
        let batchId;
        try {
            await conn.beginTransaction();
            const [b] = await conn.query(
                `INSERT INTO intake_batch
                   (tenant_id, filename, business_unit, rows_read, rows_valid, rows_rejected,
                    duplicates, column_map_json, uploaded_by)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
                [req.tenantId, req.file.originalname, req.body.businessUnit || null,
                 parsed.rows.length, valid.length, rejected.length,
                 rejected.filter(r => r.errors.some(e =>
                     e.code.includes('DUPLICATE') || e.code === 'ALREADY_IN_REGISTER')).length,
                 JSON.stringify(parsed.map), req.emp_id]);
            batchId = b.insertId;

            for (const r of parsed.rows) {
                await conn.query(
                    `INSERT INTO intake_row
                       (batch_id, row_no, raw_json, vendor_name, service_desc, spend_category,
                        annual_value, contract_owner, contact_email, data_access, system_access,
                        suggested_sector, confidence, status, error_code, error_message)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [batchId, r.row_no, JSON.stringify(r.raw), r.vendor_name, r.service_desc,
                     r.spend_category, Number.isFinite(r.annual_value) ? r.annual_value : null,
                     r.contract_owner, r.contact_email, r.data_access, r.system_access,
                     r.suggested_sector, r.confidence,
                     r.errors.length ? 'rejected' : 'ok',
                     r.errors.length ? r.errors[0].code : null,
                     r.errors.length ? r.errors.map(e => e.message).join('; ').slice(0, 400) : null]);
            }
            await conn.commit();
        } catch (e) {
            await conn.rollback().catch(() => {});
            throw e;
        } finally { conn.release(); }

        await audit(req, {
            action: 'intake.previewed', entity: 'intake_batch', entityId: batchId,
            after: { read: parsed.rows.length, valid: valid.length, rejected: rejected.length },
            tenantId: req.tenantId,
        });

        res.json({
            batchId,
            columnMap: parsed.map,
            unmappedColumns: parsed.unmapped,
            summary: { read: parsed.rows.length, valid: valid.length, rejected: rejected.length },
            rows: parsed.rows.map(r => ({
                rowNo: r.row_no, vendorName: r.vendor_name, serviceDesc: r.service_desc,
                spendCategory: r.spend_category, contactEmail: r.contact_email,
                dataAccess: r.data_access, systemAccess: r.system_access,
                suggestedSector: r.suggested_sector, confidence: r.confidence,
                matched: r.matched || [], errors: r.errors,
            })),
        });
    } catch (e) {
        logError("intake preview", e, req);
        res.status(500).json({ error: "Could not read that workbook" });
    }
});

/** The rejected rows as CSV, so the client gets a precise fix list. */
router.get("/intake/:batchId/errors.csv", requirePerm('vendor.manage'), async (req, res) => {
    try {
        const [[batch]] = await db.query(
            `SELECT tenant_id FROM intake_batch WHERE batch_id=?`, [req.params.batchId]);
        if (!batch) return res.status(404).json({ error: "That upload was not found" });

        // Tenant check, not just a permission check. Without this a user with
        // vendor.manage on client A could read client B's supplier names by
        // guessing a batch id.
        req.tenantId = Number(batch.tenant_id);
        if (!requireTenant(req, res)) return;

        const [rows] = await db.query(
            `SELECT row_no, vendor_name, error_code, error_message FROM intake_row
              WHERE batch_id=? AND status='rejected' ORDER BY row_no`, [req.params.batchId]);
        const esc = v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
        const csv = ['Row,Supplier,Error code,What to fix']
            .concat(rows.map(r => [r.row_no, r.vendor_name, r.error_code, r.error_message].map(esc).join(',')))
            .join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="intake_errors_${req.params.batchId}.csv"`);
        res.send(csv);
    } catch (e) {
        logError("errors.csv", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------------------------- 3. commit the valid rows */
router.post("/intake/:batchId/commit", requirePerm('vendor.manage'), async (req, res) => {
    const conn = await db.getConnection();
    try {
        const [[batch]] = await db.query(
            `SELECT * FROM intake_batch WHERE batch_id=?`, [req.params.batchId]);
        if (!batch) return res.status(404).json({ error: "That upload was not found" });
        if (batch.state === 'committed') {
            return res.status(409).json({ error: "ALREADY_COMMITTED", message: "That upload has already been imported" });
        }
        req.tenantId = Number(batch.tenant_id);
        if (!requireTenant(req, res)) return;

        const [rows] = await db.query(
            `SELECT * FROM intake_row WHERE batch_id=? AND status='ok' ORDER BY row_no`, [batch.batch_id]);
        if (!rows.length) {
            return res.status(400).json({ error: "NOTHING_TO_IMPORT", message: "Every row in that upload was rejected" });
        }

        await conn.beginTransaction();

        // Reference codes are allocated from the current max rather than a
        // COUNT, so deleting a supplier can never cause the next one to
        // collide with an existing code.
        const [[seq]] = await conn.query(
            `SELECT COALESCE(MAX(CAST(SUBSTRING(ref_code, 4) AS UNSIGNED)), 0) AS mx
               FROM third_party WHERE tenant_id=? FOR UPDATE`, [batch.tenant_id]);
        let next = Number(seq.mx) + 1;

        let created = 0;
        for (const r of rows) {
            const sector = r.confirmed_sector || r.suggested_sector || 'GENERIC';
            const ref = `TP-${String(batch.tenant_id).padStart(2, '0')}${String(next++).padStart(4, '0')}`;
            const [tp] = await conn.query(
                `INSERT INTO third_party
                   (tenant_id, ref_code, third_party_name, sector_code, service_desc,
                    contract_owner, security_contact, annual_value, created_by)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
                [batch.tenant_id, ref, r.vendor_name, sector, r.service_desc,
                 r.contract_owner, r.contact_email, r.annual_value, req.emp_id]);
            await conn.query(
                `UPDATE intake_row SET status='imported', third_party_id=? WHERE intake_row_id=?`,
                [tp.insertId, r.intake_row_id]);

            // The two Y/N triage answers arrived with the intake sheet, so the
            // obvious cases are pre-decided. An assessor still confirms every
            // one on the Triage step; this only saves them the easy clicks.
            if (r.data_access === 'N' && r.system_access === 'N') {
                await conn.query(
                    `INSERT INTO triage_decision
                       (third_party_id, in_scope, reason, rule_version, decided_by, recheck_due)
                     VALUES (?,0,?,?,?, DATE_ADD(CURDATE(), INTERVAL 1 YEAR))`,
                    [tp.insertId,
                     'Auto-descoped at intake: no access to client data and no connection to client systems. Confirm on the Triage step.',
                     'v1', req.emp_id]);
            }
            created++;
        }

        await conn.query(
            `UPDATE intake_batch SET state='committed', committed_time=NOW(3) WHERE batch_id=?`,
            [batch.batch_id]);
        await conn.commit();

        await audit(req, {
            action: 'intake.committed', entity: 'intake_batch', entityId: batch.batch_id,
            after: { imported: created }, tenantId: batch.tenant_id,
        });
        res.json({ success: true, imported: created });
    } catch (e) {
        await conn.rollback().catch(() => {});
        logError("intake commit", e, req);
        res.status(500).json({ error: "Database error" });
    } finally {
        conn.release();
    }
});

/* ------------------------------------------- 4. classification review */
// Sorted worst-confidence first, so an assessor reviews only what the rules
// were unsure about instead of scrolling through 400 obvious matches.
router.get("/:tenantId/classification", requirePerm('vendor.manage'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [rows] = await db.query(
            `SELECT tp.third_party_id, tp.ref_code, tp.third_party_name, tp.service_desc,
                    tp.sector_code, s.sector_name, ir.spend_category, ir.confidence, ir.suggested_sector
               FROM third_party tp
               LEFT JOIN sector s ON s.sector_code = tp.sector_code
               LEFT JOIN intake_row ir ON ir.third_party_id = tp.third_party_id
              WHERE tp.tenant_id = ? AND tp.deleted_time IS NULL
              ORDER BY ir.confidence IS NULL DESC, ir.confidence ASC, tp.third_party_name`,
            [req.tenantId]);
        res.json(rows);
    } catch (e) {
        logError("classification", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.put("/third-parties/:id/sector", requirePerm('vendor.manage'), async (req, res) => {
    try {
        const { sectorCode } = req.body;
        const [[tp]] = await db.query(
            `SELECT * FROM third_party WHERE third_party_id=?`, [req.params.id]);
        if (!tp) return res.status(404).json({ error: "That supplier does not exist" });
        req.tenantId = Number(tp.tenant_id);
        if (!requireTenant(req, res)) return;

        const [[sec]] = await db.query(`SELECT sector_code FROM sector WHERE sector_code=?`, [sectorCode]);
        if (!sec) return res.status(400).json({ error: "That instrument does not exist" });

        // Changing the questionnaire mid-flight would mean the supplier
        // answered one set of questions and we scored a different one.
        const [[live]] = await db.query(
            `SELECT COUNT(*) AS n FROM assessment WHERE third_party_id=? AND state <> 'draft'`, [tp.third_party_id]);
        if (Number(live.n) > 0) {
            return res.status(409).json({
                error: "ASSESSMENT_IN_FLIGHT",
                message: "This supplier has an assessment under way. Changing the instrument needs a new cycle.",
            });
        }

        await db.query(
            `UPDATE third_party SET sector_code=?, edited_by=?, edited_time=NOW(3) WHERE third_party_id=?`,
            [sectorCode, req.emp_id, tp.third_party_id]);
        await db.query(
            `UPDATE intake_row SET confirmed_sector=? WHERE third_party_id=?`, [sectorCode, tp.third_party_id]);

        await audit(req, {
            action: 'vendor.reclassified', entity: 'third_party', entityId: tp.third_party_id,
            before: { sector: tp.sector_code }, after: { sector: sectorCode }, tenantId: tp.tenant_id,
        });
        res.json({ success: true });
    } catch (e) {
        logError("reclassify", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* --------------------------------------------------------- 5. triage */
router.get("/:tenantId/triage", requirePerm('vendor.manage'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [rows] = await db.query(
            `SELECT tp.third_party_id, tp.ref_code, tp.third_party_name, tp.sector_code,
                    tp.annual_value, s.sector_name,
                    ir.data_access, ir.system_access,
                    td.in_scope, td.reason, td.decided_time
               FROM third_party tp
               LEFT JOIN sector s ON s.sector_code = tp.sector_code
               LEFT JOIN intake_row ir ON ir.third_party_id = tp.third_party_id
               LEFT JOIN triage_decision td ON td.third_party_id = tp.third_party_id
              WHERE tp.tenant_id = ? AND tp.deleted_time IS NULL
              ORDER BY td.in_scope IS NULL DESC, tp.third_party_name`,
            [req.tenantId]);
        res.json(rows);
    } catch (e) {
        logError("triage", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/third-parties/:id/triage", requirePerm('triage.decide'), async (req, res) => {
    try {
        const { inScope, reason } = req.body;
        const [[tp]] = await db.query(`SELECT * FROM third_party WHERE third_party_id=?`, [req.params.id]);
        if (!tp) return res.status(404).json({ error: "That supplier does not exist" });
        req.tenantId = Number(tp.tenant_id);
        if (!requireTenant(req, res)) return;

        // A descope is the decision an auditor will question first, so it can
        // never be a bare click.
        if (!inScope && (!reason || String(reason).trim().length < 10)) {
            return res.status(400).json({
                error: "REASON_REQUIRED",
                message: "A descope decision needs a written reason of at least 10 characters. It has to stand up to an auditor.",
            });
        }

        await db.query(
            `INSERT INTO triage_decision
               (third_party_id, in_scope, reason, rule_version, decided_by, recheck_due)
             VALUES (?,?,?,?,?, DATE_ADD(CURDATE(), INTERVAL 1 YEAR))
             ON DUPLICATE KEY UPDATE in_scope=VALUES(in_scope), reason=VALUES(reason),
               decided_by=VALUES(decided_by), decided_time=NOW(3), recheck_due=VALUES(recheck_due)`,
            [tp.third_party_id, inScope ? 1 : 0, reason || null, 'v1', req.emp_id]);

        await audit(req, {
            action: inScope ? 'triage.in_scope' : 'triage.descoped',
            entity: 'third_party', entityId: tp.third_party_id,
            reason: reason || null, tenantId: tp.tenant_id,
        });
        res.json({ success: true });
    } catch (e) {
        logError("triage decide", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* --------------------------------------------- 6. the population funnel */
router.get("/:tenantId/funnel", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;
        const t = req.tenantId;

        const [[r]] = await db.query(
            `SELECT
              (SELECT COUNT(*) FROM third_party WHERE tenant_id=? AND deleted_time IS NULL) AS received,
              (SELECT COUNT(*) FROM third_party WHERE tenant_id=? AND deleted_time IS NULL
                 AND sector_code <> 'GENERIC') AS classified,
              (SELECT COUNT(*) FROM triage_decision td JOIN third_party tp
                    ON tp.third_party_id = td.third_party_id
                WHERE tp.tenant_id=? AND td.in_scope=1) AS in_scope,
              (SELECT COUNT(*) FROM assessment WHERE tenant_id=? AND tier IS NOT NULL) AS tiered,
              (SELECT COUNT(*) FROM distribution d JOIN assessment a
                    ON a.assessment_id = d.assessment_id
                WHERE a.tenant_id=? AND d.state IN ('zipped','emailed','reminded','returned','imported')) AS issued,
              (SELECT COUNT(*) FROM assessment WHERE tenant_id=?
                 AND state IN ('approved','issued','closed')) AS assessed`,
            [t, t, t, t, t, t]);
        res.json(r);
    } catch (e) {
        logError("funnel", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------------------------------ 7. the register itself */
router.get("/:tenantId/third-parties", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [rows] = await db.query(
            `SELECT tp.*, s.sector_name, td.in_scope, td.reason AS triage_reason,
                    a.assessment_id, a.state AS assessment_state, a.tier, a.inherent_score,
                    a.effectiveness, a.residual_score, a.residual_band,
                    (SELECT COUNT(*) FROM finding f
                      WHERE f.assessment_id = a.assessment_id
                        AND f.status IN ('open','in_progress')) AS open_findings
               FROM third_party tp
               LEFT JOIN sector s ON s.sector_code = tp.sector_code
               LEFT JOIN triage_decision td ON td.third_party_id = tp.third_party_id
               LEFT JOIN assessment a ON a.assessment_id = (
                   SELECT assessment_id FROM assessment
                    WHERE third_party_id = tp.third_party_id ORDER BY assessment_id DESC LIMIT 1)
              WHERE tp.tenant_id = ? AND tp.deleted_time IS NULL
              ORDER BY tp.third_party_name`,
            [req.tenantId]);
        res.json(rows);
    } catch (e) {
        logError("third-parties", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/:tenantId/third-parties", requirePerm('vendor.manage'), async (req, res) => {
    const conn = await db.getConnection();
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const { name, sectorCode, serviceDesc, country, contractOwner, securityContact, annualValue } = req.body;
        if (!name || !sectorCode) return res.status(400).json({ error: "Supplier name and instrument are required" });

        await conn.beginTransaction();
        const [[seq]] = await conn.query(
            `SELECT COALESCE(MAX(CAST(SUBSTRING(ref_code, 4) AS UNSIGNED)), 0) AS mx
               FROM third_party WHERE tenant_id=? FOR UPDATE`, [req.tenantId]);
        const ref = `TP-${String(req.tenantId).padStart(2, '0')}${String(Number(seq.mx) + 1).padStart(4, '0')}`;

        const [r] = await conn.query(
            `INSERT INTO third_party
               (tenant_id, ref_code, third_party_name, sector_code, service_desc, country,
                contract_owner, security_contact, annual_value, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [req.tenantId, ref, name, sectorCode, serviceDesc || null, country || null,
             contractOwner || null, securityContact || null, annualValue || null, req.emp_id]);
        await conn.commit();

        await audit(req, {
            action: 'vendor.created', entity: 'third_party', entityId: r.insertId,
            after: { name, sectorCode }, tenantId: req.tenantId,
        });
        res.status(201).json({ success: true, third_party_id: r.insertId, ref_code: ref });
    } catch (e) {
        await conn.rollback().catch(() => {});
        logError("create third party", e, req);
        res.status(500).json({ error: "Database error" });
    } finally {
        conn.release();
    }
});

module.exports = router;
