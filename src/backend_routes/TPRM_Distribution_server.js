// Getting questionnaires out to suppliers and reading them back in.
//
// THE IMPORT MODEL. A returned workbook lands as ASSERTIONS, not answers:
//
//   • Answer + evidence attached  → stored at the claimed position, flagged
//                                   vendor_asserted. An assessor accepts it,
//                                   in bulk per control area.
//   • Answer, no evidence         → drops to Not Evidenced and scores 1,
//                                   automatically. The claim is preserved in
//                                   the assessor note so it can still be read.
//   • In scope but came back blank → the same automatic drop.
//
// The assessor's time therefore goes only where evidence is missing or
// contested, and the score shown before they have looked at anything is
// already honest rather than flattering.

require("dotenv").config({ quiet: true });
const express = require("express");
const multer = require("multer");
const archiver = require("archiver");
const unzipper = require("unzipper");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requireTenant, requirePerm, permitted } = require('./utils/tprm_audit');
const excel = require('./utils/tprm_excel');
const scoring = require('./utils/tprm_scoring');
const storage = require('./utils/tprm_storage');
const mailer = require('./utils/tprm_mailer');
const contradiction = require('./utils/tprm_contradiction');
const A = require('./TPRM_Assessments_server');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

router.use(verifyJWT, tenantScope);

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ------------------------------------------------- 1. the tiering pack */
/* ===================================================== mail preview =====
   Nothing here sends a questionnaire that could not have been looked at first.
   Two routes serve that:

     /email/recipients  one cheap row per supplier, no rendered HTML
     /email/preview     one supplier's real email, rendered

   Split on purpose. A 50-supplier run costs one roster call plus one render
   per email somebody actually opens, rather than 50 renders nobody reads.

   Both call the same render function the send path calls, so a preview cannot
   show one thing and the send deliver another. */

/** The rule the send route applies, in one place so the roster cannot drift
 *  from it: a questionnaire needs a tier and somewhere to send it. */
const questionnaireSendable = (a) => a.tier != null && !!a.security_contact;

const skipReason = (a) =>
    a.tier == null ? 'not tiered'
        : !a.security_contact ? 'no email'
            : null;

// POST /:tenantId/email/recipients   { assessmentIds?: [] }
router.post("/:tenantId/email/recipients", requirePerm('assessment.assign'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const only = Array.isArray(req.body.assessmentIds) ? req.body.assessmentIds : [];
        const [rows] = await db.query(
            `SELECT a.assessment_id, a.tier, a.state, tp.third_party_name, tp.ref_code,
                    tp.security_contact, s.sector_name, d.state AS dist_state
               FROM assessment a
               JOIN third_party tp ON tp.third_party_id = a.third_party_id
               LEFT JOIN sector s ON s.sector_code = tp.sector_code
               LEFT JOIN distribution d ON d.assessment_id = a.assessment_id
              WHERE a.tenant_id = ?
                ${only.length ? `AND a.assessment_id IN (${only.map(() => '?').join(',')})` : ''}
              ORDER BY tp.third_party_name`,
            only.length ? [req.tenantId, ...only] : [req.tenantId]);

        const recipients = rows.map(a => ({
            id: a.assessment_id,
            record_no: a.ref_code,
            name: a.third_party_name,
            department: a.sector_name || null,
            to: a.security_contact || null,
            has_email: !!a.security_contact,
            status: a.tier == null ? 'Not tiered' : (a.dist_state || 'ready'),
            period_label: a.tier != null ? `Tier ${a.tier}` : '-',
            sendable: questionnaireSendable(a),
            skip_reason: skipReason(a),
        }));

        res.json({
            recipients,
            sendable_count: recipients.filter(r => r.sendable).length,
            no_email_count: recipients.filter(r => !r.has_email).length,
            not_eligible_count: recipients.filter(r => r.tier === null || r.status === 'Not tiered').length,
        });
    } catch (e) {
        logError("email/recipients", e, req);
        res.status(500).json({ error: "Could not build the recipient list" });
    }
});

// POST /:tenantId/email/preview   { assessmentId, reminder? }
router.post("/:tenantId/email/preview", requirePerm('assessment.assign'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const id = Number(req.body.assessmentId);
        if (!id) return res.status(400).json({ error: "assessmentId required" });

        const [[a]] = await db.query(
            `SELECT a.assessment_id, a.tier, tp.third_party_name, tp.security_contact,
                    t.tenant_name, d.state AS dist_state
               FROM assessment a
               JOIN third_party tp ON tp.third_party_id = a.third_party_id
               JOIN tenant t ON t.tenant_id = a.tenant_id
               LEFT JOIN distribution d ON d.assessment_id = a.assessment_id
              WHERE a.assessment_id = ? AND a.tenant_id = ?`,
            [id, req.tenantId]);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });

        const reminder = !!req.body.reminder;
        // The same call the send path makes, with the same arguments.
        const { subject, html } = mailer.templates.renderVendorQuestionnaireEmail({
            vendorName: a.third_party_name,
            tenantName: a.tenant_name,
            days: reminder ? 5 : 15,
            reminder,
        });

        res.json({
            from: mailer.mailFrom(),
            to: a.security_contact || null,
            cc: mailer.resolveCc(a.security_contact, null),
            subject,
            html,
            recipient_name: a.third_party_name,
            status: a.tier == null ? 'Not tiered' : (a.dist_state || 'ready'),
            has_email: !!a.security_contact,
            sendable: questionnaireSendable(a),
            skip_reason: skipReason(a),
        });
    } catch (e) {
        logError("email/preview", e, req);
        res.status(500).json({ error: "Could not render the preview" });
    }
});

/* The pack is built the same way whichever door it leaves by - downloaded and
   sent by hand, or emailed from here - so the two routes share one builder and
   cannot drift into sending different workbooks.

   Throws NOTHING_IN_SCOPE rather than returning an empty file: a tiering pack
   with no rows in it is not something anyone should be able to send. */
async function buildTieringPack(tenantId) {
    const [[t]] = await db.query(`SELECT tenant_name FROM tenant WHERE tenant_id=?`, [tenantId]);
    const [vendors] = await db.query(
        `SELECT tp.third_party_id, tp.third_party_name, tp.sector_code, s.sector_name
           FROM third_party tp
           JOIN triage_decision td ON td.third_party_id = tp.third_party_id AND td.in_scope = 1
           LEFT JOIN sector s ON s.sector_code = tp.sector_code
          WHERE tp.tenant_id = ? AND tp.deleted_time IS NULL
          ORDER BY tp.third_party_name`, [tenantId]);
    if (!vendors.length) {
        const err = new Error(
            "No suppliers are in scope after triage yet. Complete the Triage step first.");
        err.nothingInScope = true;
        throw err;
    }

    /* The core twelve, asked of every supplier. DISTINCT because every
       published instrument carries its own copy of the same question. */
    const [core] = await db.query(
        `SELECT DISTINCT q.q_ref, q.dimension_code, q.q_text,
                q.score_1_label, q.score_2_label, q.score_3_label, q.sort_order
           FROM question q
           JOIN instrument_version iv
             ON iv.instrument_version_id = q.instrument_version_id AND iv.status='published'
          WHERE q.q_type='tiering' AND q.is_core=1
          ORDER BY q.sort_order, q.q_ref`);

    /* Sector questions, carrying the sector they belong to. One workbook holds
       every supplier, so these become columns like any other - but the pack
       locks the cell on rows the question does not apply to, or the caterer
       gets asked how deep its reach into the process estate is. */
    const [extra] = await db.query(
        `SELECT q.q_ref, q.dimension_code, q.q_text,
                q.score_1_label, q.score_2_label, q.score_3_label, q.sort_order,
                iv.sector_code
           FROM question q
           JOIN instrument_version iv
             ON iv.instrument_version_id = q.instrument_version_id AND iv.status='published'
          WHERE q.q_type='tiering' AND q.is_core=0
            AND iv.sector_code IN (
                SELECT DISTINCT tp.sector_code FROM third_party tp
                  JOIN triage_decision td
                    ON td.third_party_id = tp.third_party_id AND td.in_scope = 1
                 WHERE tp.tenant_id = ? AND tp.deleted_time IS NULL)
          ORDER BY iv.sector_code, q.sort_order, q.q_ref`, [tenantId]);

    const questions = core.map(q => ({ ...q, sector_code: null })).concat(extra);

    const buf = await excel.tieringPack({ tenantName: t.tenant_name, questions, vendors });
    return { tenantName: t.tenant_name, vendors, buf };
}

const nothingInScope = (res, e) => res.status(400).json({
    error: "NOTHING_IN_SCOPE", message: e.message,
});

/* Which instruments the in-scope population actually needs, and whether each
   one has a questionnaire published to bind an assessment to.

   This is asked BEFORE the pack goes out. Finding out that eleven of twelve
   instruments were never published only when the completed pack comes back -
   after the client has done the work of filling it in - is the wrong end of
   the job to discover it at.

   EXISTS rather than a join: a sector could hold more than one published
   version, and joining would multiply the supplier count by however many. */
router.get("/:tenantId/tiering-readiness", requirePerm('assessment.perform'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [rows] = await db.query(
            `SELECT tp.sector_code, s.sector_name, COUNT(*) AS suppliers,
                    EXISTS (SELECT 1 FROM instrument_version iv
                             WHERE iv.sector_code = tp.sector_code
                               AND iv.status = 'published') AS published
               FROM third_party tp
               JOIN triage_decision td
                 ON td.third_party_id = tp.third_party_id AND td.in_scope = 1
               LEFT JOIN sector s ON s.sector_code = tp.sector_code
              WHERE tp.tenant_id = ? AND tp.deleted_time IS NULL
              GROUP BY tp.sector_code, s.sector_name
              ORDER BY published, s.sector_name`, [req.tenantId]);

        const blocked = rows.filter(r => !Number(r.published));
        res.json({
            instruments: rows.length,
            blockedInstruments: blocked.length,
            inScope: rows.reduce((n, r) => n + Number(r.suppliers), 0),
            blockedSuppliers: blocked.reduce((n, r) => n + Number(r.suppliers), 0),
            blocked: blocked.map(r => ({
                sectorCode: r.sector_code,
                sectorName: r.sector_name || r.sector_code,
                suppliers: Number(r.suppliers),
            })),
        });
    } catch (e) {
        logError("tiering-readiness", e, req);
        res.status(500).json({ error: "Could not check the instruments" });
    }
});

router.get("/:tenantId/tiering-pack", requirePerm('assessment.perform'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const { vendors, buf } = await buildTieringPack(req.tenantId);
        await audit(req, {
            action: 'tiering.pack_downloaded', entity: 'tenant', entityId: req.tenantId,
            after: { vendors: vendors.length }, tenantId: req.tenantId,
        });
        res.setHeader('Content-Type', XLSX_MIME);
        res.setHeader('Content-Disposition',
            `attachment; filename="Tiering_Pack_${vendors.length}_suppliers.xlsx"`);
        res.send(Buffer.from(buf));
    } catch (e) {
        if (e.nothingInScope) return nothingInScope(res, e);
        logError("tiering-pack", e, req);
        res.status(500).json({ error: "Could not build the tiering pack" });
    }
});

/* Email the pack to the client, the way the intake template goes out in step 1.
   It goes to the client, never to a supplier: these twelve questions are about
   the client's relationship with the supplier and only the client can answer
   them. Queued through the outbox first, so nothing is lost if the mail
   provider is briefly unavailable. */
router.post("/:tenantId/tiering-pack/email", requirePerm('assessment.perform'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const { to } = req.body;
        if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
            return res.status(400).json({ error: "A valid recipient email is required" });
        }

        const { tenantName, vendors, buf } = await buildTieringPack(req.tenantId);
        const filename = `Tiering_Pack_${vendors.length}_suppliers.xlsx`;
        const key = storage.keyFor(`tenant/${req.tenantId}/tiering`, filename);
        storage.put(key, Buffer.from(buf));

        const tpl = mailer.templates.renderTieringPackEmail(
            { tenantName, count: vendors.length });
        await mailer.queue({
            tenantId: req.tenantId, to, subject: tpl.subject, body: tpl.text, html: tpl.html,
            attachmentKey: key, attachmentName: filename,
            kind: 'tiering_pack', empId: req.emp_id,
        });
        await audit(req, {
            action: 'tiering.pack_emailed', entity: 'tenant', entityId: req.tenantId,
            after: { to, vendors: vendors.length }, tenantId: req.tenantId,
        });
        res.json({
            success: true,
            message: `Tiering pack for ${vendors.length} suppliers queued for ${to}`,
        });
    } catch (e) {
        if (e.nothingInScope) return nothingInScope(res, e);
        logError("tiering-pack email", e, req);
        res.status(500).json({ error: "Could not queue the tiering pack" });
    }
});

/** Read a completed tiering pack back and create/score one assessment per row. */
router.post("/:tenantId/tiering-pack/import", requirePerm('assessment.perform'),
    upload.single('file'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;
        if (!req.file) return res.status(400).json({ error: "Attach the completed tiering pack" });

        let parsed;
        try { parsed = await excel.parseTieringPack(req.file.buffer); }
        catch (e) { return res.status(400).json({ error: e.code || 'FILE_UNREADABLE', message: e.message }); }

        const results = [];
        let tiered = 0;

        for (const row of parsed.rows) {
            const [[tp]] = await db.query(
                `SELECT * FROM third_party WHERE third_party_id=? AND tenant_id=?`,
                [row.third_party_id, req.tenantId]);
            if (!tp) {
                results.push({ supplier: row.third_party_name, status: 'skipped', message: 'Not a supplier of this client' });
                continue;
            }
            if (!row.answers.length) {
                results.push({ supplier: tp.third_party_name, status: 'skipped', message: 'No scores entered' });
                continue;
            }

            // Find or create the open assessment for this supplier
            let [[a]] = await db.query(
                `SELECT * FROM assessment WHERE third_party_id=?
                  AND state IN ('draft','in_progress') ORDER BY assessment_id DESC LIMIT 1`,
                [tp.third_party_id]);

            if (!a) {
                const [[iv]] = await db.query(
                    `SELECT instrument_version_id FROM instrument_version
                      WHERE sector_code=? AND status='published' ORDER BY version_no DESC LIMIT 1`,
                    [tp.sector_code]);
                if (!iv) {
                    results.push({
                        supplier: tp.third_party_name, status: 'skipped',
                        message: `No published questionnaire for ${tp.sector_code}`,
                    });
                    continue;
                }
                const [ins] = await db.query(
                    `INSERT INTO assessment (tenant_id, third_party_id, instrument_version_id, created_by)
                     VALUES (?,?,?,?)`,
                    [req.tenantId, tp.third_party_id, iv.instrument_version_id, req.emp_id]);
                [[a]] = await db.query(`SELECT * FROM assessment WHERE assessment_id=?`, [ins.insertId]);
            }

            for (const ans of row.answers) {
                await db.query(
                    `INSERT INTO response (assessment_id, q_ref, q_type, tiering_score, answered_by, answered_time)
                     VALUES (?,?,'tiering',?,?,NOW(3))
                     ON DUPLICATE KEY UPDATE tiering_score=VALUES(tiering_score), answered_time=NOW(3)`,
                    [a.assessment_id, ans.q_ref, ans.score, req.emp_id]);
            }
            if (a.state === 'draft') {
                await db.query(`UPDATE assessment SET state='in_progress' WHERE assessment_id=?`, [a.assessment_id]);
            }
            const out = await A.recompute(a.assessment_id);
            tiered++;
            results.push({
                supplier: tp.third_party_name, status: 'tiered',
                assessmentId: a.assessment_id, answered: row.answers.length,
                expected: row.expected, tier: out.tier, inherent: out.inherent,
                partial: row.answers.length < row.expected,
            });
        }

        await audit(req, {
            action: 'tiering.pack_imported', entity: 'tenant', entityId: req.tenantId,
            after: { tiered }, tenantId: req.tenantId,
        });
        res.json({ success: true, tiered, problems: parsed.problems, results });
    } catch (e) {
        logError("tiering import", e, req);
        res.status(500).json({ error: "Could not read that workbook" });
    }
});

/* ---------------------------------- 2. issue the control questionnaires */

async function controlsFor(a) {
    const [rows] = await db.query(
        `SELECT q.q_ref, q.q_text, q.evidence_required, q.domain_code, q.standards_mapping,
                cd.domain_name
           FROM question q LEFT JOIN control_domain cd ON cd.domain_code = q.domain_code
          WHERE q.instrument_version_id=? AND q.q_type='control' AND q.tier_applies >= ?
          ORDER BY cd.sort_order, q.sort_order, q.q_ref`,
        [a.instrument_version_id, a.tier || 3]);
    return rows;
}

async function markIssued(req, a, channel, recipient, key) {
    await db.query(
        `INSERT INTO distribution
           (assessment_id, channel, state, recipient, workbook_key, issued_time, issued_by)
         VALUES (?,?,?,?,?,NOW(3),?)
         ON DUPLICATE KEY UPDATE channel=VALUES(channel), state=VALUES(state),
           recipient=VALUES(recipient), workbook_key=VALUES(workbook_key),
           issued_time=NOW(3), issued_by=VALUES(issued_by)`,
        [a.assessment_id, channel, channel === 'zip' ? 'zipped' : 'emailed',
         recipient || null, key || null, req.emp_id]);
}

/** Route A: one ZIP of every workbook, which the client forwards itself.
 *  This is a GET so the browser can stream the download directly. */
router.get("/:tenantId/issue-zip", requirePerm('assessment.perform'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [[t]] = await db.query(`SELECT tenant_name FROM tenant WHERE tenant_id=?`, [req.tenantId]);
        const only = req.query.assessmentIds
            ? String(req.query.assessmentIds).split(',').map(Number).filter(Boolean) : [];

        const [list] = await db.query(
            `SELECT a.*, tp.third_party_name, tp.ref_code, tp.security_contact, tp.sector_code, s.sector_name
               FROM assessment a
               JOIN third_party tp ON tp.third_party_id = a.third_party_id
               LEFT JOIN sector s ON s.sector_code = tp.sector_code
              WHERE a.tenant_id=? AND a.tier IS NOT NULL
                ${only.length ? `AND a.assessment_id IN (${only.map(() => '?').join(',')})` : ''}
              ORDER BY tp.third_party_name`,
            only.length ? [req.tenantId, ...only] : [req.tenantId]);

        if (!list.length) {
            return res.status(400).json({
                error: "NOTHING_TIERED",
                message: "No tiered suppliers are ready for a questionnaire. Complete the Tiering step first.",
            });
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition',
            `attachment; filename="${t.tenant_name.replace(/\W+/g, '_')}_questionnaires_${list.length}.zip"`);

        const zip = archiver('zip', { zlib: { level: 9 } });
        zip.on('error', e => { logError('zip', e, req); res.end(); });
        zip.pipe(res);

        for (const a of list) {
            const controls = await controlsFor(a);
            const wb = await excel.controlWorkbook({
                tenantName: t.tenant_name,
                vendor: {
                    third_party_id: a.third_party_id, third_party_name: a.third_party_name,
                    sector_code: a.sector_code, sector_name: a.sector_name,
                },
                assessment: a, controls,
            });
            zip.append(Buffer.from(wb), {
                name: `${a.third_party_name.replace(/\W+/g, '_')}_${a.ref_code}.xlsx`,
            });
        }

        /* Building the file changes nothing. Downloading it used to mark every
           supplier issued, which meant a second download reset issued_time and
           dragged rows that had reached emailed or reminded back to zipped.
           Saying a questionnaire went out is a separate act, and it is
           /mark-issued below. */
        await audit(req, {
            action: 'questionnaire.zip_downloaded', entity: 'tenant', entityId: req.tenantId,
            after: { count: list.length, marked: false }, tenantId: req.tenantId,
        });
        zip.finalize();
    } catch (e) {
        logError("issue-zip", e, req);
        if (!res.headersSent) res.status(500).json({ error: "Could not build the ZIP" });
    }
});

/** Route B: we email each supplier its own workbook, with the file attached. */
router.post("/:tenantId/issue-email", requirePerm('assessment.perform'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [[t]] = await db.query(`SELECT tenant_name FROM tenant WHERE tenant_id=?`, [req.tenantId]);
        const only = Array.isArray(req.body.assessmentIds) ? req.body.assessmentIds : [];

        const [list] = await db.query(
            `SELECT a.*, tp.third_party_name, tp.ref_code, tp.security_contact, tp.sector_code, s.sector_name
               FROM assessment a
               JOIN third_party tp ON tp.third_party_id = a.third_party_id
               LEFT JOIN sector s ON s.sector_code = tp.sector_code
              WHERE a.tenant_id=? AND a.tier IS NOT NULL
                ${only.length ? `AND a.assessment_id IN (${only.map(() => '?').join(',')})` : ''}`,
            only.length ? [req.tenantId, ...only] : [req.tenantId]);

        if (!list.length) {
            return res.status(400).json({ error: "NOTHING_TIERED", message: "No tiered suppliers are ready for a questionnaire" });
        }

        let sent = 0;
        const skipped = [];
        for (const a of list) {
            if (!a.security_contact) {
                skipped.push({ supplier: a.third_party_name, reason: 'No security contact on file' });
                continue;
            }
            const controls = await controlsFor(a);
            const wb = await excel.controlWorkbook({
                tenantName: t.tenant_name,
                vendor: {
                    third_party_id: a.third_party_id, third_party_name: a.third_party_name,
                    sector_code: a.sector_code, sector_name: a.sector_name,
                },
                assessment: a, controls,
            });
            const fileName = `${a.third_party_name.replace(/\W+/g, '_')}_questionnaire.xlsx`;
            const key = storage.keyFor(`tenant/${req.tenantId}/questionnaire`, fileName);
            storage.put(key, Buffer.from(wb));

            const tpl = mailer.templates.renderVendorQuestionnaireEmail({
                vendorName: a.third_party_name, tenantName: t.tenant_name, days: 15,
            });
            await mailer.queue({
                tenantId: req.tenantId, to: a.security_contact,
                subject: tpl.subject, body: tpl.text, html: tpl.html,
                attachmentKey: key, attachmentName: fileName,
                kind: 'questionnaire', empId: req.emp_id,
            });
            await markIssued(req, a, 'email', a.security_contact, key);
            sent++;
        }

        await audit(req, {
            action: 'questionnaire.emailed', entity: 'tenant', entityId: req.tenantId,
            after: { sent, skipped: skipped.length }, tenantId: req.tenantId,
        });
        res.json({ success: true, sent, skipped });
    } catch (e) {
        logError("issue-email", e, req);
        res.status(500).json({ error: "Could not queue the questionnaires" });
    }
});

/* Issuing by hand.
 *
 * Downloading a file is not the same act as issuing a questionnaire, and this
 * is the difference: the download builds bytes, this records that somebody
 * sent them. Two channels reach it - 'zip' when the pack went to the client to
 * forward, 'manual' when a workbook was pulled out of the ZIP and mailed
 * personally - and neither can be inferred from a click on a download button.
 *
 * A row already past 'ready' is never touched. That is the whole point: the
 * previous behaviour reset issued_time and knocked 'reminded' back to
 * 'zipped', losing how long the supplier had actually held it. Rows that are
 * skipped are named in the reply rather than silently ignored, so marking a
 * whole population is honest about what it did and did not change. */
router.post("/:tenantId/mark-issued", requirePerm('assessment.perform'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const channel = String(req.body.channel || '');
        if (!['zip', 'manual'].includes(channel)) {
            return res.status(400).json({
                error: "BAD_CHANNEL",
                message: "Channel must be 'zip' for a pack sent to the client, "
                    + "or 'manual' for a workbook you sent yourself.",
            });
        }
        const ids = Array.isArray(req.body.assessmentIds)
            ? req.body.assessmentIds.map(Number).filter(Boolean) : [];

        const [list] = await db.query(
            `SELECT a.assessment_id, tp.third_party_name, tp.security_contact,
                    d.state, d.channel AS prev_channel
               FROM assessment a
               JOIN third_party tp ON tp.third_party_id = a.third_party_id
               LEFT JOIN distribution d ON d.assessment_id = a.assessment_id
              WHERE a.tenant_id = ? AND a.tier IS NOT NULL
                ${ids.length ? `AND a.assessment_id IN (${ids.map(() => '?').join(',')})` : ''}
              ORDER BY tp.third_party_name`,
            ids.length ? [req.tenantId, ...ids] : [req.tenantId]);

        if (!list.length) {
            return res.status(400).json({
                error: "NOTHING_TIERED",
                message: "No tiered suppliers to mark. Complete the Tiering step first.",
            });
        }

        const marked = [];
        const skipped = [];
        for (const a of list) {
            // Anything already issued keeps the history it has.
            if (a.state && a.state !== 'ready') {
                skipped.push({ supplier: a.third_party_name, state: a.state });
                continue;
            }
            await db.query(
                `INSERT INTO distribution
                   (assessment_id, channel, state, recipient, issued_time, issued_by)
                 VALUES (?,?,?,?,NOW(3),?)
                 ON DUPLICATE KEY UPDATE
                   channel = VALUES(channel), state = VALUES(state),
                   recipient = VALUES(recipient), issued_time = NOW(3),
                   issued_by = VALUES(issued_by)`,
                [
                    a.assessment_id, channel,
                    channel === 'zip' ? 'zipped' : 'emailed',
                    // A manual send went to the address on file as far as we
                    // know; a pack handed to the client went to nobody we can
                    // name, because the client chooses who forwards it.
                    channel === 'manual' ? (a.security_contact || null) : null,
                    req.emp_id,
                ]);
            marked.push(a.third_party_name);
        }

        await audit(req, {
            action: channel === 'zip' ? 'questionnaire.pack_handed_over'
                : 'questionnaire.marked_sent',
            entity: 'tenant', entityId: req.tenantId,
            after: { channel, marked: marked.length, skipped: skipped.length },
            tenantId: req.tenantId,
        });
        res.json({ marked: marked.length, skipped });
    } catch (e) {
        logError("mark-issued", e, req);
        res.status(500).json({ error: "Could not record that" });
    }
});

router.get("/:tenantId/status", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'vendor.manage')) return;

        const [rows] = await db.query(
            `SELECT d.*, a.assessment_id, a.tier, a.state AS assessment_state,
                    tp.third_party_name, tp.ref_code, tp.security_contact, s.sector_name
               FROM assessment a
               JOIN third_party tp ON tp.third_party_id = a.third_party_id
               LEFT JOIN sector s ON s.sector_code = tp.sector_code
               LEFT JOIN distribution d ON d.assessment_id = a.assessment_id
              WHERE a.tenant_id=? AND a.tier IS NOT NULL
              ORDER BY tp.third_party_name`, [req.tenantId]);

        /* d.* is worth keeping here - this table drives eight columns and the
           step rail, and naming them all would go stale the next time one is
           added. What is not worth keeping is the storage path of the issued
           questionnaire: the page never reads it, and a file key in a browser
           is a link to a supplier's pack for as long as anyone has a copy of
           it. Downloads go through the routes that check who is asking. */
        rows.forEach(r => { delete r.workbook_key; });
        res.json(rows);
    } catch (e) {
        logError("distribution status", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/assessments/:id/remind", requirePerm('assessment.perform'), async (req, res) => {
    try {
        const a = await A.loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;

        const [[d]] = await db.query(
            `SELECT * FROM distribution WHERE assessment_id=?`, [a.assessment_id]);
        if (!d) return res.status(400).json({ error: "NOT_ISSUED", message: "That questionnaire has not been issued yet" });
        if (!d.recipient) {
            return res.status(400).json({
                error: "NO_RECIPIENT",
                message: "That questionnaire went out in a ZIP, so the client is chasing it, not us.",
            });
        }

        // reminder:true swaps the hero and subject; everything else is the
        // same message, so the supplier sees one consistent thread.
        const tpl = mailer.templates.renderVendorQuestionnaireEmail({
            vendorName: a.third_party_name, tenantName: a.tenant_name, days: 5,
            reminder: true,
        });
        await mailer.queue({
            tenantId: a.tenant_id, to: d.recipient,
            subject: tpl.subject, body: tpl.text, html: tpl.html,
            attachmentKey: d.workbook_key,
            attachmentName: `${a.third_party_name.replace(/\W+/g, '_')}_questionnaire.xlsx`,
            kind: 'reminder', empId: req.emp_id,
        });
        await db.query(
            `UPDATE distribution SET state='reminded', reminded_time=NOW(3) WHERE distribution_id=?`,
            [d.distribution_id]);
        await audit(req, {
            action: 'questionnaire.reminded', entity: 'assessment', entityId: a.assessment_id,
            tenantId: a.tenant_id,
        });
        res.json({ success: true });
    } catch (e) {
        logError("remind", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------------- 3. read the returned workbooks back in */

/** A single workbook or a whole returned ZIP. Both come through one path.
 *  Evidence files inside the ZIP are matched to a control by the folder or
 *  filename prefix, which is what the "Evidence folder" column asks for. */
async function explode(file) {
    const name = String(file.originalname || '').toLowerCase();
    if (!name.endsWith('.zip')) {
        return { workbooks: [{ name: file.originalname, buffer: file.buffer }], evidence: [] };
    }
    const dir = await unzipper.Open.buffer(file.buffer);
    const workbooks = [], evidence = [];
    for (const entry of dir.files) {
        if (entry.type !== 'File') continue;
        if (entry.path.startsWith('__MACOSX') || entry.path.includes('/.')) continue;
        const buf = await entry.buffer();
        if (/\.xlsx$/i.test(entry.path)) workbooks.push({ name: entry.path, buffer: buf });
        else evidence.push({ path: entry.path, buffer: buf });
    }
    return { workbooks, evidence };
}

/** Which control does this evidence file belong to? Folder name wins, then a
 *  filename prefix such as "IAM-02_mfa_policy.pdf". */
function evidenceRefFor(entryPath, knownRefs) {
    const parts = entryPath.split('/').filter(Boolean);
    for (const p of parts) {
        const hit = knownRefs.find(r => r.toLowerCase() === p.toLowerCase());
        if (hit) return hit;
    }
    const base = parts[parts.length - 1] || '';
    const hit = knownRefs.find(r => base.toLowerCase().startsWith(r.toLowerCase()));
    return hit || null;
}

router.post("/import/preview", requirePerm('assessment.perform'),
    upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Attach the returned workbook or ZIP" });
        const { workbooks, evidence } = await explode(req.file);
        if (!workbooks.length) {
            return res.status(400).json({ error: "NO_WORKBOOK", message: "That file contains no .xlsx questionnaire" });
        }

        const results = [];
        for (const f of workbooks) {
            try {
                const parsed = await excel.parseControlWorkbook(f.buffer);
                const aid = Number(parsed.meta.assessment_id);
                const [[a]] = await db.query(`SELECT * FROM assessment WHERE assessment_id=?`, [aid]);
                if (!a) {
                    results.push({
                        file: f.name, status: 'skipped', code: 'ASSESSMENT_UNKNOWN',
                        message: 'The identity sheet points at an assessment that no longer exists',
                    });
                    continue;
                }
                // Tenant check on preview too. Otherwise a crafted identity
                // sheet would reveal another client's supplier names.
                if (!req.grants[a.tenant_id]) {
                    results.push({
                        file: f.name, status: 'skipped', code: 'NOT_A_MEMBER',
                        message: 'That workbook belongs to a client you do not have access to',
                    });
                    continue;
                }

                const [[tp]] = await db.query(
                    `SELECT third_party_name FROM third_party WHERE third_party_id=?`, [a.third_party_id]);
                const [refRows] = await db.query(
                    `SELECT q_ref FROM question WHERE instrument_version_id=? AND q_type='control'`,
                    [a.instrument_version_id]);
                const known = refRows.map(r => r.q_ref);
                const knownSet = new Set(known);

                const matched = parsed.answers.filter(x => knownSet.has(x.q_ref));
                const unknown = parsed.answers.filter(x => !knownSet.has(x.q_ref))
                    .map(x => ({
                        ref: x.q_ref, code: 'REF_NOT_IN_INSTRUMENT',
                        message: 'That reference is not part of this questionnaire version',
                    }));

                const evidenceByRef = {};
                for (const ev of evidence) {
                    const ref = evidenceRefFor(ev.path, known);
                    if (ref) evidenceByRef[ref] = (evidenceByRef[ref] || 0) + 1;
                }
                const withEvidence = matched.filter(x => evidenceByRef[x.q_ref]).length;

                results.push({
                    file: f.name, status: 'ready', assessmentId: aid,
                    supplier: tp ? tp.third_party_name : null,
                    rows: parsed.answers.length + parsed.problems.length,
                    willImport: matched.length,
                    withEvidence,
                    willDropToNotEvidenced: matched.length - withEvidence,
                    evidenceFiles: evidence.length,
                    cannotMatch: [...parsed.problems, ...unknown],
                });
            } catch (e) {
                results.push({
                    file: f.name, status: 'skipped',
                    code: e.code || 'UNREADABLE', message: e.message,
                });
            }
        }
        res.json({ files: results.length, evidenceFiles: evidence.length, results });
    } catch (e) {
        logError("import preview", e, req);
        res.status(500).json({ error: "Could not read that file" });
    }
});

router.post("/import/commit", requirePerm('assessment.perform'),
    upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Attach the returned workbook or ZIP" });
        const { workbooks, evidence } = await explode(req.file);

        let imported = 0, asserted = 0, autoDropped = 0, evidenceSaved = 0;
        const perFile = [];

        for (const f of workbooks) {
            let parsed;
            try { parsed = await excel.parseControlWorkbook(f.buffer); }
            catch (e) { perFile.push({ file: f.name, status: 'skipped', message: e.message }); continue; }

            const aid = Number(parsed.meta.assessment_id);
            const [[a]] = await db.query(`SELECT * FROM assessment WHERE assessment_id=?`, [aid]);
            if (!a) { perFile.push({ file: f.name, status: 'skipped', message: 'Unknown assessment' }); continue; }
            if (!req.grants[a.tenant_id]) {
                perFile.push({ file: f.name, status: 'skipped', message: 'Not your client' });
                continue;
            }
            if (['approved', 'issued', 'closed'].includes(a.state)) {
                perFile.push({ file: f.name, status: 'skipped', message: 'That assessment is already approved' });
                continue;
            }

            const [refRows] = await db.query(
                `SELECT q_ref FROM question WHERE instrument_version_id=? AND q_type='control'`,
                [a.instrument_version_id]);
            const known = refRows.map(r => r.q_ref);
            const knownSet = new Set(known);

            // Bucket the evidence files by control reference first, so we know
            // which answers are actually backed by something.
            const evidenceByRef = {};
            for (const ev of evidence) {
                const ref = evidenceRefFor(ev.path, known);
                if (!ref) continue;
                (evidenceByRef[ref] = evidenceByRef[ref] || []).push(ev);
            }

            let n = 0, dropped = 0;
            for (const ans of parsed.answers) {
                if (!knownSet.has(ans.q_ref)) continue;

                const hasEvidence = !!(evidenceByRef[ans.q_ref] && evidenceByRef[ans.q_ref].length);
                const isNA = ans.position === 'Not Applicable';

                // The rule, applied here and nowhere else. A claim with no
                // proof is Not Evidenced, and the original claim is kept in
                // the note so the assessor can still read what was asserted.
                let position, vendorAsserted, note = ans.note || null;
                if (isNA) {
                    position = 'Not Applicable';
                    vendorAsserted = 0;
                } else if (hasEvidence) {
                    position = ans.position;
                    vendorAsserted = 1;
                } else {
                    position = 'Not Evidenced';
                    vendorAsserted = 0;
                    note = `Supplier claimed "${ans.position}" with no evidence attached.`
                        + (ans.note ? ` Their note: ${ans.note}` : '');
                    dropped++;
                }

                await db.query(
                    `INSERT INTO response
                       (assessment_id, q_ref, q_type, position, control_score, assessor_note,
                        vendor_asserted, answered_time)
                     VALUES (?,?,'control',?,?,?,?,NOW(3))
                     ON DUPLICATE KEY UPDATE position=VALUES(position),
                       control_score=VALUES(control_score), assessor_note=VALUES(assessor_note),
                       vendor_asserted=VALUES(vendor_asserted), answered_time=NOW(3)`,
                    [aid, ans.q_ref, position, scoring.POSITION_SCORE[position], note, vendorAsserted]);

                if (vendorAsserted) asserted++;
                n++;

                // Store the evidence files against the response we just wrote
                if (hasEvidence) {
                    const [[resp]] = await db.query(
                        `SELECT response_id FROM response WHERE assessment_id=? AND q_ref=?`, [aid, ans.q_ref]);
                    for (const ev of evidenceByRef[ans.q_ref]) {
                        const base = ev.path.split('/').pop();
                        const key = storage.keyFor(`tenant/${a.tenant_id}/evidence/${aid}`, base);
                        const put = storage.put(key, ev.buffer);
                        await db.query(
                            `INSERT INTO evidence
                               (response_id, file_key, original_name, mime_type, byte_size, sha256, uploaded_by)
                             VALUES (?,?,?,?,?,?,?)`,
                            [resp.response_id, key, base, null, ev.buffer.length, put.sha256, req.emp_id]);
                        evidenceSaved++;
                    }
                }
            }

            // Anything in scope that came back with nothing at all gets the
            // same automatic drop. Silence is not a pass.
            const [missing] = await db.query(
                `SELECT q.q_ref FROM question q
                  WHERE q.instrument_version_id=? AND q.q_type='control' AND q.tier_applies >= ?
                    AND NOT EXISTS (SELECT 1 FROM response r
                                     WHERE r.assessment_id=? AND r.q_ref=q.q_ref)`,
                [a.instrument_version_id, a.tier || 3, aid]);
            for (const m of missing) {
                await db.query(
                    `INSERT INTO response
                       (assessment_id, q_ref, q_type, position, control_score, assessor_note,
                        vendor_asserted, answered_time)
                     VALUES (?,?,'control','Not Evidenced',1,'Left blank in the returned workbook.',0,NOW(3))`,
                    [aid, m.q_ref]);
            }
            autoDropped += dropped + missing.length;

            if (a.state === 'draft') {
                await db.query(`UPDATE assessment SET state='in_progress' WHERE assessment_id=?`, [aid]);
            }
            await db.query(
                `UPDATE distribution SET state='imported',
                        returned_time=COALESCE(returned_time, NOW(3)), imported_time=NOW(3)
                  WHERE assessment_id=?`, [aid]);

            await contradiction.refresh(aid, a.instrument_version_id);
            await A.recompute(aid);

            await audit(req, {
                action: 'responses.imported', entity: 'assessment', entityId: aid,
                after: { rows: n, droppedNoEvidence: dropped, blank: missing.length },
                tenantId: a.tenant_id,
            });
            imported += n;
            perFile.push({
                file: f.name, status: 'imported', assessmentId: aid, rows: n,
                droppedNoEvidence: dropped, blankDropped: missing.length,
            });
        }

        res.json({
            success: true, imported, vendorAsserted: asserted,
            autoNotEvidenced: autoDropped, evidenceSaved, files: perFile,
        });
    } catch (e) {
        logError("import commit", e, req);
        res.status(500).json({ error: "Could not import that file" });
    }
});

module.exports = router;
