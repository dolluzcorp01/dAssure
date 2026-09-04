// Report generation and issuance.
//
// PDFKit rather than Puppeteer, deliberately. Puppeteer needs a headless
// Chrome and roughly 4 GB of RAM; PDFKit is pure JavaScript and runs in about
// 50 MB, so this works on the existing droplet instead of waiting for a
// bigger one.

require("dotenv").config({ quiet: true });
const express = require("express");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requireTenant, requirePerm, permitted } = require('./utils/tprm_audit');
const excel = require('./utils/tprm_excel');
const storage = require('./utils/tprm_storage');
const mailer = require('./utils/tprm_mailer');
const A = require('./TPRM_Assessments_server');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();
const dadmin = getDBConnection('dadmin').promise();

router.use(verifyJWT, tenantScope);

const LOGO = path.join(__dirname, '..', 'assets', 'img', 'logo_eagle.png');
const NAVY = '#0D1B2A';
const GOLD = '#C9A227';
const MUTED = '#5E6E80';
const LINE = '#DCE3EB';
const BODY = '#3D4A5F';

/* ---------------------------------------------------- build the PDF */
async function buildReportPdf(a) {
    const [[tenant]] = await db.query(`SELECT * FROM tenant WHERE tenant_id=?`, [a.tenant_id]);
    const [[tp]] = await db.query(`SELECT * FROM third_party WHERE third_party_id=?`, [a.third_party_id]);
    const [responses] = await db.query(
        `SELECT r.q_ref, r.position, r.control_score, r.override_reason, r.assessor_note,
                q.domain_code, q.q_text
           FROM response r
           JOIN question q ON q.instrument_version_id=? AND q.q_ref=r.q_ref
          WHERE r.assessment_id=? AND r.q_type='control'
          ORDER BY q.domain_code, r.q_ref`,
        [a.instrument_version_id, a.assessment_id]);
    const [findings] = await db.query(
        `SELECT * FROM finding WHERE assessment_id=?
          ORDER BY FIELD(severity,'Critical','High','Medium','Low')`, [a.assessment_id]);
    const [flags] = await db.query(
        `SELECT * FROM contradiction_flag WHERE assessment_id=?`, [a.assessment_id]);
    const [domains] = await db.query(
        `SELECT domain_code, domain_name FROM control_domain ORDER BY sort_order`);

    const domName = {};
    domains.forEach(d => { domName[d.domain_code] = d.domain_name; });

    const doc = new PDFDocument({
        size: 'A4', margin: 48,
        info: { Title: `Third Party Assessment Report - ${tp.third_party_name}`, Author: 'Dolluz Corp' },
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise(r => doc.on('end', r));

    const reference = `TPRM-${tenant.tenant_code}-${tp.ref_code}-${String(a.assessment_id).padStart(4, '0')}`;

    /* --- cover block --- */
    if (fs.existsSync(LOGO)) doc.image(LOGO, 48, 40, { width: 130 });
    doc.fontSize(8).fillColor(MUTED).text('Document reference', 380, 44, { width: 170, align: 'right' });
    doc.fontSize(10).fillColor(NAVY).text(reference, 380, 56, { width: 170, align: 'right' });
    doc.fontSize(8).fillColor(MUTED).text(
        new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        380, 70, { width: 170, align: 'right' });

    doc.moveTo(48, 100).lineTo(547, 100).strokeColor(GOLD).lineWidth(2).stroke();
    doc.fontSize(19).fillColor(NAVY).text('Third Party Assessment Report', 48, 116);
    doc.fontSize(9).fillColor(MUTED)
        .text(`${tenant.tenant_name}  |  ${tp.sector_code} questionnaire  |  Classification: confidential`, 48, 142);

    let y = 172;
    const box = (x, label, value, sub) => {
        doc.roundedRect(x, y, 118, 62, 4).strokeColor(LINE).lineWidth(1).stroke();
        doc.fontSize(7).fillColor(MUTED).text(String(label).toUpperCase(), x + 10, y + 10, { width: 100 });
        doc.fontSize(15).fillColor(NAVY).text(String(value), x + 10, y + 24, { width: 100 });
        if (sub) doc.fontSize(7).fillColor(MUTED).text(sub, x + 10, y + 44, { width: 100 });
    };
    box(48, 'Third party', String(tp.third_party_name).slice(0, 16), tp.ref_code);
    box(174, 'Inherent risk', a.inherent_score === null ? 'n/a' : a.inherent_score, a.tier ? `Tier ${a.tier}` : '');
    box(300, 'Effectiveness',
        a.effectiveness === null ? 'n/a' : Math.round(a.effectiveness * 100) + '%',
        `${responses.length} controls`);
    box(426, 'Residual risk', a.residual_score === null ? 'n/a' : a.residual_score, a.residual_band || '');
    y += 84;

    let sectionNo = 0;
    const heading = (t) => {
        sectionNo++;
        if (y > 700) { doc.addPage(); y = 60; }
        doc.fontSize(10).fillColor(NAVY).text(`${sectionNo}. ${t}`, 48, y);
        y += 16;
        doc.moveTo(48, y).lineTo(547, y).strokeColor(LINE).lineWidth(0.5).stroke();
        y += 10;
    };

    /* --- 1. summary --- */
    heading('Assessment summary');
    const effPct = a.effectiveness === null ? 0 : Math.round(a.effectiveness * 100);
    const critHigh = findings.filter(f => ['Critical', 'High'].includes(f.severity)).length;
    doc.fontSize(8.5).fillColor(BODY).text(
        `${tp.third_party_name} provides ${tp.service_desc || 'services'} to ${tenant.tenant_name} and has been `
        + `tiered at Tier ${a.tier || '-'} against the ${tp.sector_code} questionnaire, on a weighted inherent `
        + `score of ${a.inherent_score === null ? '-' : a.inherent_score}. Control effectiveness across `
        + `${responses.length} assessed controls is ${effPct}%, giving a residual risk position of `
        + `${a.residual_score === null ? '-' : a.residual_score}, rated ${a.residual_band || '-'}. `
        + `${findings.length} findings were raised, of which ${critHigh} are critical or high severity.`,
        48, y, { width: 499, lineGap: 2 });
    y = doc.y + 16;

    /* --- 2. effectiveness by area --- */
    heading('Control effectiveness by area');
    const byDom = {};
    responses.forEach(r => {
        const d = byDom[r.domain_code] || (byDom[r.domain_code] = { got: 0, max: 0, n: 0 });
        if (r.control_score !== null) { d.got += r.control_score; d.max += 2; }
        d.n++;
    });
    doc.fontSize(7).fillColor(MUTED);
    doc.text('CONTROL AREA', 48, y);
    doc.text('CONTROLS', 330, y);
    doc.text('SCORE', 400, y);
    doc.text('EFFECTIVENESS', 470, y);
    y += 12;
    for (const [code, d] of Object.entries(byDom)) {
        if (y > 740) { doc.addPage(); y = 60; }
        const pct = d.max ? Math.round((d.got / d.max) * 100) : 0;
        doc.fontSize(8.5).fillColor(NAVY).text(domName[code] || code, 48, y, { width: 270 });
        doc.fillColor(BODY).text(String(d.n), 330, y);
        doc.text(`${d.got}/${d.max}`, 400, y);
        doc.fillColor(pct >= 75 ? '#1B7A5A' : pct >= 50 ? '#C4881B' : '#B0392E').text(`${pct}%`, 470, y);
        y += 15;
    }
    y += 10;

    /* --- 3. contradictions, only if any --- */
    if (flags.length) {
        heading('Contradictions escalated');
        for (const f of flags) {
            if (y > 700) { doc.addPage(); y = 60; }
            doc.fontSize(8.5).fillColor('#B0392E').text(f.refs_label, 48, y);
            doc.fontSize(8).fillColor(BODY).text(f.message, 48, y + 11, { width: 499, lineGap: 1 });
            y = doc.y + 10;
        }
    }

    /* --- 4. findings --- */
    if (findings.length) {
        heading('Findings and agreed actions');
        for (const f of findings) {
            if (y > 690) { doc.addPage(); y = 60; }
            const sevColor = { Critical: '#B0392E', High: '#C4881B', Medium: '#185FA5', Low: MUTED }[f.severity];
            doc.fontSize(8).fillColor(sevColor).text(`${f.finding_ref}  ${f.severity.toUpperCase()}`, 48, y);
            doc.fontSize(8).fillColor(MUTED).text(
                `${f.control_ref}   due ${String(f.due_at).slice(0, 10)}`, 400, y, { width: 147, align: 'right' });
            doc.fontSize(8.5).fillColor(NAVY).text(String(f.title).slice(0, 240), 48, y + 12, { width: 499 });
            y = doc.y + 12;
        }
    }

    /* --- 5. scope note --- */
    heading('Scope and basis of this assessment');
    doc.fontSize(8).fillColor(BODY).text(
        'This assessment is based on the responses and supporting evidence provided by the third party, '
        + 'and on the relationship information provided by the client. It is a point in time review and does '
        + 'not constitute a penetration test, a technical audit, or a certification.\n\n'
        + 'Where a control was asserted but no supporting evidence was supplied, the control is recorded as '
        + 'Not Evidenced and scored accordingly. An assertion is not evidence.\n\n'
        + 'This document is confidential to ' + tenant.tenant_name + '.',
        48, y, { width: 499, lineGap: 2 });

    /* --- footer on every page --- */
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.fontSize(7).fillColor(MUTED).text(
            `${reference}   |   Confidential   |   Page ${i + 1} of ${range.count}`,
            48, 800, { width: 499, align: 'center' });
    }

    doc.end();
    await done;
    return { buffer: Buffer.concat(chunks), reference };
}

/* ------------------------------------------------- download the report */
router.get("/assessments/:id/pdf", requirePerm('report.generate'), async (req, res) => {
    try {
        const a = await A.loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;

        if (!['approved', 'issued', 'closed'].includes(a.state)) {
            return res.status(409).json({
                error: "NOT_APPROVED",
                message: "A report can only be produced from an approved assessment. Submit it for review first.",
            });
        }

        const { buffer, reference } = await buildReportPdf(a);
        await audit(req, {
            action: 'report.generated', entity: 'assessment', entityId: a.assessment_id,
            after: { reference }, tenantId: a.tenant_id,
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${reference}.pdf"`);
        res.send(buffer);
    } catch (e) {
        logError("report pdf", e, req);
        res.status(500).json({ error: "Could not build the report" });
    }
});

/* ---------------------------------------------- issue it to the client */
router.post("/assessments/:id/issue", requirePerm('report.issue'), async (req, res) => {
    try {
        const a = await A.loadAssessment(req.params.id);
        if (!a) return res.status(404).json({ error: "That assessment does not exist" });
        req.tenantId = Number(a.tenant_id);
        if (!requireTenant(req, res)) return;

        if (!['approved', 'issued'].includes(a.state)) {
            return res.status(409).json({ error: "NOT_APPROVED", message: "Only an approved assessment can be issued" });
        }
        const recipients = String(req.body.recipients || '').trim();
        if (!recipients) return res.status(400).json({ error: "Name at least one recipient" });

        const { buffer, reference } = await buildReportPdf(a);
        const sha = crypto.createHash('sha256').update(buffer).digest('hex');
        const key = storage.keyFor(`tenant/${a.tenant_id}/reports`, `${reference}.pdf`);
        storage.put(key, buffer);

        // The stored hash is what lets us prove later that the file we sent is
        // the file being disputed.
        await db.query(
            `INSERT INTO report_issue
               (tenant_id, assessment_id, report_type, doc_reference, file_key, sha256,
                recipients, cc_recipients, subject, issued_by)
             VALUES (?,?, 'assessment', ?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE file_key=VALUES(file_key), sha256=VALUES(sha256),
               recipients=VALUES(recipients), issued_time=NOW(3)`,
            [a.tenant_id, a.assessment_id, reference, key, sha, recipients,
             req.body.cc || null, req.body.subject || null, req.emp_id]);

        const tpl = mailer.templates.renderReportIssueEmail({
            tenantName: a.tenant_name, vendorName: a.third_party_name, reference,
        });
        await mailer.queue({
            tenantId: a.tenant_id, to: recipients, cc: req.body.cc || null,
            subject: req.body.subject || tpl.subject, body: tpl.text, html: tpl.html,
            attachmentKey: key, attachmentName: `${reference}.pdf`,
            kind: 'report', empId: req.emp_id,
        });

        await db.query(
            `UPDATE assessment SET state='issued', issued_time=NOW(3) WHERE assessment_id=?`,
            [a.assessment_id]);
        await db.query(
            `INSERT INTO case_message (assessment_id, msg_kind, body)
             VALUES (?, 'activity', ?)`,
            [a.assessment_id, `Report ${reference} issued to ${recipients}`]);

        await audit(req, {
            action: 'report.issued', entity: 'assessment', entityId: a.assessment_id,
            after: { reference, recipients, sha256: sha }, tenantId: a.tenant_id,
        });
        res.json({ success: true, reference, sha256: sha });
    } catch (e) {
        logError("issue report", e, req);
        res.status(500).json({ error: "Could not issue the report" });
    }
});

/* --------------------------------------------------- issuance history */
router.get("/:tenantId/issuances", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'report.generate')) return;

        const [rows] = await db.query(
            /* Named columns rather than ri.*, so that file_key stays on the
               server. It is the storage path of a confidential PDF, the page
               has no use for it, and anything sent to a browser is one
               screenshot away from being somewhere else. The sha256 IS sent -
               that is the point of it, a fingerprint to check a file against. */
            `SELECT ri.report_issue_id, ri.doc_reference, ri.recipients, ri.cc_recipients,
                    ri.subject, ri.issued_by, ri.issued_time, ri.sha256, ri.assessment_id,
                    tp.third_party_name
               FROM report_issue ri
               LEFT JOIN assessment a ON a.assessment_id = ri.assessment_id
               LEFT JOIN third_party tp ON tp.third_party_id = a.third_party_id
              WHERE ri.tenant_id=? ORDER BY ri.issued_time DESC`, [req.tenantId]);

        const ids = [...new Set(rows.map(r => r.issued_by).filter(Boolean))];
        let names = {};
        if (ids.length) {
            const [emps] = await dadmin.query(
                `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name FROM employee WHERE emp_id IN (${ids.map(() => '?').join(',')})`, ids);
            emps.forEach(e => { names[e.emp_id] = e.emp_name; });
        }
        rows.forEach(r => { r.issued_by_name = names[r.issued_by] || 'Unknown'; });
        res.json(rows);
    } catch (e) {
        logError("issuances", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------------------------- export the whole register */
router.get("/:tenantId/register.xlsx", requirePerm('report.generate'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [[t]] = await db.query(`SELECT tenant_name FROM tenant WHERE tenant_id=?`, [req.tenantId]);
        const [rows] = await db.query(
            `SELECT tp.ref_code, tp.third_party_name, tp.sector_code, tp.contract_owner,
                    s.sector_name, td.in_scope,
                    a.state AS assessment_state, a.tier, a.inherent_score, a.effectiveness,
                    a.residual_score, a.residual_band,
                    (SELECT COUNT(*) FROM finding f WHERE f.assessment_id=a.assessment_id
                       AND f.status IN ('open','in_progress')) AS open_findings
               FROM third_party tp
               LEFT JOIN sector s ON s.sector_code = tp.sector_code
               LEFT JOIN triage_decision td ON td.third_party_id = tp.third_party_id
               LEFT JOIN assessment a ON a.assessment_id = (
                   SELECT assessment_id FROM assessment
                    WHERE third_party_id = tp.third_party_id ORDER BY assessment_id DESC LIMIT 1)
              WHERE tp.tenant_id=? AND tp.deleted_time IS NULL
              ORDER BY tp.third_party_name`, [req.tenantId]);

        const buf = await excel.registerExport({ tenantName: t.tenant_name, rows });
        await audit(req, {
            action: 'register.exported', entity: 'tenant', entityId: req.tenantId,
            after: { rows: rows.length }, tenantId: req.tenantId,
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition',
            `attachment; filename="Third_Party_Register_${t.tenant_name.replace(/\W+/g, '_')}.xlsx"`);
        res.send(Buffer.from(buf));
    } catch (e) {
        logError("register export", e, req);
        res.status(500).json({ error: "Could not build the register" });
    }
});

module.exports = router;
