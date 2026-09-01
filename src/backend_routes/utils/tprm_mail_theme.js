// The Dolluz Corp house email theme.
//
// One shell, every outbound message. This is the same chrome dAdmin uses for
// payslip and dSpr mail (src/utils/Payslip_EmailSender.js there): navy #0D1B2A
// masthead carrying the "Dolluz Corp." wordmark, orange #E8520A accent, DM Sans,
// a tinted hero card, an #F8FAFC note box and the copyright footer. Keeping TPRM
// mail on the same shell means every message a person gets from Dolluz Corp -
// sign-in code, questionnaire, report - looks like it came from one company.
//
// Copied rather than imported: dAdmin's module opens a connection to the dslip
// schema at require time, and TPRM mail must not depend on a dAdmin database.
//
// Every render function here is PURE and returns { subject, html, text }. The
// preview routes and the real send path both call these, so a preview can never
// drift from what is actually delivered.

require("dotenv").config({ quiet: true });

const NAVY = "#0D1B2A";
const ORANGE = "#E8520A";

// The one address a reader is ever told to write to. Mail leaves through the
// connect@ mailbox, but connect@ is never surfaced, and neither is hr@ - that
// sits on the functional CC routing list only.
const CONTACT = process.env.TPRM_MAIL_CONTACT || "admin@dolluzcorp.com";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * A body that is already a full HTML document is passed through untouched.
 * Templates edited and stored by staff hold the whole document; legacy plain
 * text still gets the shell wrapped around it.
 */
const looksLikeHtml = (b) =>
    /^<(?:!doctype|html|div|table|body)\b/i.test(String(b || "").trim());

/* ------------------------------------------------------------ the shell */

/**
 * The standard 600px message.
 *
 * preheader is the line the inbox list shows beside the subject. Without one,
 * clients scrape the first text they find in the markup and the preview reads
 * like source code.
 */
function buildShell({ preheader, eyebrow, heroEmoji, heroTitle, heroSub, bodyHtml, noteHtml, footerNote }) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'DM Sans',Arial,sans-serif;background:#F0F4F8;color:${NAVY}">
  <span style="display:none;max-height:0;overflow:hidden">${esc(preheader || "")}</span>
  <div style="max-width:600px;margin:0 auto">
    <div style="background:${NAVY};padding:20px 32px">
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">Dolluz Corp<span style="color:${ORANGE}">.</span></div>
      ${eyebrow ? `<div style="font-size:11px;color:#94A3B8;letter-spacing:2px;text-transform:uppercase;margin-top:4px">${eyebrow}</div>` : ""}
    </div>
    <div style="background:#fff;padding:32px">
      ${heroTitle ? `<div style="padding:28px 24px;border-radius:10px;margin-bottom:24px;text-align:center;background:#FBE9DC;border:1.5px solid #F5C8A5">
        <div style="font-size:36px;margin-bottom:12px">${heroEmoji || "\u{1F4C4}"}</div>
        <h1 style="color:${ORANGE};font-size:20px;font-weight:700;margin:0 0 8px">${heroTitle}</h1>
        ${heroSub ? `<p style="font-size:14px;line-height:1.5;margin:0;color:#7C3500">${heroSub}</p>` : ""}
      </div>` : ""}
      ${bodyHtml || ""}
      <p style="font-size:14px;line-height:1.7;margin:24px 0 0;color:#374151">Warm regards,<br><strong>Dolluz Corp<span style="color:${ORANGE}">.</span></strong></p>
      ${noteHtml ? `<div style="background:#F8FAFC;border-radius:8px;padding:14px 18px;margin-top:24px;font-size:12.5px;color:#64748B;line-height:1.6">${noteHtml}</div>` : ""}
    </div>
    <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:18px 32px;text-align:center;font-size:11px;color:#94A3B8">
      &copy; ${new Date().getFullYear()} Dolluz Corp<span style="color:${ORANGE}">.</span> All rights reserved.<br>
      ${footerNote || `Questions? <a href="mailto:${CONTACT}" style="color:${ORANGE}">${CONTACT}</a>`}
    </div>
  </div>
</body>
</html>`;
}

/**
 * The narrower 520px card used for a one-time code.
 *
 * No hero and no call to action on purpose: the only thing on this screen that
 * should attract the eye is the six digits, and a button beside them is an
 * invitation to click something in an email about authentication.
 */
function buildOtpShell({ preheader, eyebrow, title, intro, code, warning }) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'DM Sans',Arial,sans-serif;background:#F0F4F8;color:${NAVY}">
  <span style="display:none;max-height:0;overflow:hidden">${esc(preheader || "")}</span>
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)">
    <div style="background:${NAVY};padding:20px 32px">
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">Dolluz Corp<span style="color:${ORANGE}">.</span></div>
      ${eyebrow ? `<div style="font-size:11px;color:#94A3B8;letter-spacing:2px;text-transform:uppercase;margin-top:4px">${eyebrow}</div>` : ""}
    </div>
    <div style="background:#fff;padding:32px">
      <div style="font-size:15px;font-weight:700;color:${NAVY};margin-bottom:8px">${esc(title)}</div>
      <div style="font-size:13px;color:#64748B;line-height:1.6;margin-bottom:24px">${intro}</div>
      <div style="background:#F8FAFC;border:2px dashed ${ORANGE};border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
        <div style="font-family:'Courier New',monospace;font-size:36px;font-weight:800;color:${ORANGE};letter-spacing:10px">${esc(code)}</div>
      </div>
      <div style="font-size:12px;color:#94A3B8;line-height:1.6">${warning || "If you did not request this, please ignore this email. Do not share this OTP with anyone."}</div>
    </div>
    <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:18px 32px;text-align:center;font-size:11px;color:#94A3B8">
      &copy; ${new Date().getFullYear()} Dolluz Corp<span style="color:${ORANGE}">.</span> All rights reserved.<br>
      Questions? <a href="mailto:${CONTACT}" style="color:${ORANGE}">${CONTACT}</a>
    </div>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------ shared fragments */

const p = (html) =>
    `<p style="font-size:14px;line-height:1.7;margin:0 0 14px;color:#374151">${html}</p>`;

const cta = (href, label) =>
    `<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 22px;background:${ORANGE};color:#fff !important;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px;line-height:1.2">${label}</a>`;

/** Name on the left, action on the right, ruled off above and below. */
const detailRow = (leftHtml, rightHtml) => `
        <table style="width:100%;border-collapse:collapse;margin:18px 0;border-top:1px solid #E2E8F0;border-bottom:1px solid #E2E8F0">
          <tr>
            <td style="padding:16px 0;font-size:14.5px;color:#1F2937;vertical-align:middle">${leftHtml}</td>
            <td style="padding:16px 0;text-align:right;vertical-align:middle">${rightHtml || ""}</td>
          </tr>
        </table>`;

const contactLink = `<a href="mailto:${CONTACT}" style="color:${ORANGE};text-decoration:none">${CONTACT}</a>`;

module.exports = {
    NAVY, ORANGE, CONTACT,
    esc, looksLikeHtml, buildShell, buildOtpShell, p, cta, detailRow, contactLink,
};
