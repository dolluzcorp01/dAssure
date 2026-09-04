// Outbox pattern, same as dNews. Every message is written to
// tprm_mail_outbox first and only then handed to SendGrid. If SendGrid is
// down the row stays `queued` and the background worker retries it, so a
// provider outage can never lose a questionnaire.

require("dotenv").config({ quiet: true });
const fs = require('fs');
const path = require('path');
const sgMail = require('@sendgrid/mail');
const getDBConnection = require('../../../config/db');
const { logMail, logError } = require('./tprm_log');
const { buildShell, looksLikeHtml } = require('./tprm_mail_theme');
const templates = require('./tprm_mail_templates');

const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();

const DRIVER = process.env.TPRM_MAIL_DRIVER || 'outbox';
// Everything goes out through the connect@ mailbox, but connect@ is never the
// address we put in front of a reader. Anywhere a person is told where to
// write - reply-to, or the sign-off in a template - it is CONTACT.
const FROM = process.env.TPRM_MAIL_FROM || 'connect@dolluzcorp.com';
const FROM_NAME = process.env.TPRM_MAIL_FROM_NAME || 'Dolluz Corp TPRM';
const CONTACT = process.env.TPRM_MAIL_CONTACT || 'admin@dolluzcorp.com';

// Mail addressed to the admin inbox is copied to these two. Mail to anyone
// else is left alone, so a supplier never sees an internal address.
const ADMIN_CC = (process.env.TPRM_MAIL_ADMIN_CC
    || 'anandthshoban@dolluzcorp.com,hr@dolluzcorp.com')
    .split(',').map(x => x.trim()).filter(Boolean);

/** Accepts an array or a comma-separated string, returns a clean array. */
const addrs = v => (Array.isArray(v) ? v : String(v || '').split(','))
    .map(x => x.trim()).filter(Boolean);

/** Adds the admin copies only when CONTACT is one of the recipients. */
function ccWithAdminCopies(to, cc) {
    const list = addrs(cc);
    if (addrs(to).some(a => a.toLowerCase() === CONTACT.toLowerCase())) {
        for (const a of ADMIN_CC) {
            if (!list.some(x => x.toLowerCase() === a.toLowerCase())) list.push(a);
        }
    }
    return list.length ? list.join(',') : null;
}
const STORAGE_DIR = process.env.TPRM_STORAGE_DIR
    || path.join(__dirname, '..', '..', '..', 'TPRM_file_uploads');

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/** Queue a message. Returns the outbox row id. */
async function queue({ tenantId, to, cc, subject, body, html, attachmentKey, attachmentName,
    kind, empId, expires }) {
    const resolvedCc = ccWithAdminCopies(to, cc);
    // A body that is already a full document is stored as it stands - that is
    // how a template edited by staff survives a round trip. Anything else is a
    // plain-text legacy body, and gets the house shell wrapped around it so it
    // still arrives looking like the rest of our mail.
    const bodyHtml = html
        || (looksLikeHtml(body)
            ? body
            : buildShell({
                preheader: String(subject || ''),
                eyebrow: 'Third Party Risk Management',
                bodyHtml: `<p style="font-size:14px;line-height:1.7;margin:0 0 14px;color:#374151;white-space:pre-wrap">${
                    String(body || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
                }</p>`,
            }));

    const [r] = await db.query(
        `INSERT INTO tprm_mail_outbox
           (tenant_id, to_addr, cc_addr, subject, body_text, body_html, attachment_key,
            attachment_name, kind, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
            tenantId || null,
            Array.isArray(to) ? to.join(',') : to,
            resolvedCc, subject, body, bodyHtml,
            attachmentKey || null, attachmentName || null,
            kind, empId || null,
        ]
    );
    const mailId = r.insertId;
    logMail('queued', {
        mailId, kind, from: FROM, fromName: FROM_NAME, to, cc: resolvedCc,
        subject, body, attachment: attachmentName || attachmentKey, driver: DRIVER,
        // Only set for a sign-in code: tells the terminal when it dies, since
        // nothing about a queued row says so.
        expires,
    });
    if (DRIVER === 'sendgrid' && process.env.SENDGRID_API_KEY) {
        await deliver(mailId).catch(() => { /* stays queued, worker retries */ });
    }
    return mailId;
}

/** Deliver one outbox row. Attachments are read from disk and base64 encoded. */
async function deliver(mailId) {
    const [[row]] = await db.query(`SELECT * FROM tprm_mail_outbox WHERE mail_id = ?`, [mailId]);
    if (!row || row.state === 'sent') return;

    const msg = {
        to: String(row.to_addr).split(',').map(s => s.trim()).filter(Boolean),
        from: { email: FROM, name: FROM_NAME },
        replyTo: { email: CONTACT, name: FROM_NAME },
        subject: row.subject,
        // Both parts: the HTML is what almost everyone sees, the text is the
        // fallback for clients that refuse HTML and for spam scoring.
        text: row.body_text,
        html: row.body_html || undefined,
    };
    if (row.cc_addr) msg.cc = String(row.cc_addr).split(',').map(s => s.trim()).filter(Boolean);

    // The attachment is the whole point of the questionnaire email. If the
    // file cannot be read we fail the row rather than silently sending an
    // email that tells a supplier to fill in a workbook that is not there.
    if (row.attachment_key) {
        const full = path.join(STORAGE_DIR, row.attachment_key);
        if (!fs.existsSync(full)) {
            await db.query(
                `UPDATE tprm_mail_outbox SET state='failed', attempts=attempts+1,
                        error='Attachment missing on disk' WHERE mail_id=?`, [mailId]);
            throw new Error('Attachment missing on disk: ' + row.attachment_key);
        }
        msg.attachments = [{
            content: fs.readFileSync(full).toString('base64'),
            filename: row.attachment_name || path.basename(row.attachment_key),
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            disposition: 'attachment',
        }];
    }

    try {
        const [res] = await sgMail.send(msg);
        await db.query(
            `UPDATE tprm_mail_outbox SET state='sent', sent_time=NOW(3), attempts=attempts+1,
                    provider_id=?, error=NULL WHERE mail_id=?`,
            [(res && res.headers && res.headers['x-message-id']) || null, mailId]
        );
        logMail('sent', {
            mailId, kind: row.kind, from: FROM, fromName: FROM_NAME,
            to: row.to_addr, cc: row.cc_addr, subject: row.subject, body: row.body_text,
            attachment: row.attachment_name,
            providerId: (res && res.headers && res.headers['x-message-id']) || null,
        });
    } catch (e) {
        await db.query(
            `UPDATE tprm_mail_outbox SET state='failed', attempts=attempts+1, error=? WHERE mail_id=?`,
            [String(e.message).slice(0, 400), mailId]
        );
        logMail('failed', {
            mailId, kind: row.kind, from: FROM, fromName: FROM_NAME,
            to: row.to_addr, cc: row.cc_addr, subject: row.subject,
            error: e.message,
        });
        throw e;
    }
}

/** Retries queued and failed rows every 60 seconds. Started from server.js. */
function startMailWorker() {
    if (DRIVER !== 'sendgrid' || !process.env.SENDGRID_API_KEY) {
        console.log('📭 dAssure mail driver = outbox. Mail is queued in tprm_mail_outbox, not sent.');
        return;
    }
    const tick = async () => {
        try {
            const [rows] = await db.query(
                `SELECT mail_id FROM tprm_mail_outbox
                  WHERE state IN ('queued','failed') AND attempts < 5
                  ORDER BY created_time LIMIT 20`
            );
            for (const r of rows) await deliver(r.mail_id).catch(() => {});
        } catch (e) {
            logError('mail worker', e);
        }
    };
    setInterval(tick, 60_000);
    tick();
    console.log('📮 dAssure mail worker started (SendGrid).');
}

/* ------------------------------------------------- what a preview must show */

/** The exact From header a send will use. */
const mailFrom = () => `"${FROM_NAME}" <${FROM}>`;

/** The exact CC list a send will use, admin copies and all. Exported so a
 *  preview shows the real routing rather than a guess at it. */
const resolveCc = (to, cc) => {
    const resolved = ccWithAdminCopies(to, cc);
    return resolved ? resolved.split(',').map(x => x.trim()).filter(Boolean) : [];
};

// templates.* are the pure render functions in tprm_mail_templates.js. The
// preview routes import the same object, so a preview cannot drift from a send.
module.exports = {
    queue, deliver, startMailWorker, templates,
    mailFrom, resolveCc, FROM, FROM_NAME, CONTACT, REPLY_TO: CONTACT,
};
