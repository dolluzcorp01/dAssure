// Every email dTPRM sends, as pure render functions.
//
// Each returns { subject, html, text }. They take plain values and touch no
// database, because BOTH the preview routes and the real send call them. That
// is the whole discipline: if preview and send were two code paths they would
// drift, and a preview that lies is worse than no preview at all.
//
// The chrome lives in tprm_mail_theme.js. Nothing here writes HTML by hand
// beyond the body of its own message.

const {
    esc, buildShell, buildOtpShell, p, cta, detailRow, contactLink, CONTACT,
} = require("./tprm_mail_theme");

/* ----------------------------------------------------------- sign-in code */

/**
 * vars: { code, minutes }
 *
 * The code goes in the subject as well as the body so it can be read off a
 * phone's notification without opening anything.
 */
function renderLoginOtpEmail(vars = {}) {
    const code = String(vars.code || "");
    const minutes = Number(vars.minutes || 2);

    return {
        subject: `[TPRM] Your verification code: ${code}`,
        html: buildOtpShell({
            preheader: `Your dTPRM sign-in code is ${code}. It expires in ${minutes} minutes.`,
            eyebrow: "Third Party Risk Management",
            title: "Verify your sign-in",
            intro: `Enter this code on the dTPRM sign-in screen to finish signing in. It expires in <strong>${minutes} minutes</strong> and can be used once.`,
            code,
            warning: `If you did not try to sign in, someone may have your password. Change it and tell ${contactLink}. Do not share this OTP with anyone.`,
        }),
        text: `Your verification code is ${code}\n\n`
            + `It expires in ${minutes} minutes and can be used once.\n\n`
            + `If you did not try to sign in to Dolluz Corp TPRM, someone has your `
            + `password. Change it, and tell ${CONTACT}.\n\n`
            + `Regards\nThird Party Risk Management\nDolluz Corp`,
    };
}

/* ------------------------------------------------------- intake template */

/** vars: { tenantName, businessUnit } */
function renderIntakeTemplateEmail(vars = {}) {
    const tenant = esc(vars.tenantName || "your organisation");
    const unit = vars.businessUnit ? ` (${esc(vars.businessUnit)})` : "";

    const bodyHtml =
        p(`Hello,`)
        + p(`Attached is the supplier intake template for <strong>${tenant}</strong>${unit}.`)
        + p(`Please export your supplier master into the sheet from row 5 onward. Do not add, remove or reorder the columns, and leave the <strong>Category</strong> column blank &mdash; we suggest that for you.`)
        + p(`There are no security questions in this file. It only asks who your suppliers are and what they do for you.`);

    return {
        subject: `Supplier intake template for ${vars.tenantName || "your organisation"}`,
        html: buildShell({
            preheader: `The supplier intake template for ${vars.tenantName || "your organisation"} is attached.`,
            eyebrow: "Third Party Risk Management",
            heroEmoji: "\u{1F4CB}",
            heroTitle: "Supplier intake template",
            heroSub: `One row per supplier. No security questions &mdash; those go to the suppliers later.`,
            bodyHtml,
            noteHtml: `The Category column is deliberately blank. Asking a procurement officer to pick from 36 cyber instruments produces worse data than letting the rules suggest it. Any questions, write to ${contactLink}.`,
        }),
        text: `Hello,\n\nAttached is the supplier intake template for ${vars.tenantName || ""}`
            + `${vars.businessUnit ? " (" + vars.businessUnit + ")" : ""}.\n\n`
            + `Please export your supplier master into the sheet from row 5 onward. `
            + `Do not add, remove or reorder the columns, and leave the Category column blank.\n\n`
            + `If you have any questions, please contact ${CONTACT}.\n\n`
            + `Regards\nThird Party Risk Management\nDolluz Corp`,
    };
}

/* ----------------------------------------------------------- tiering pack */

/** vars: { tenantName, count } */
function renderTieringPackEmail(vars = {}) {
    const tenant = esc(vars.tenantName || "your organisation");
    const count = Number(vars.count || 0);

    const bodyHtml =
        p(`Hello,`)
        + p(`Attached is the inherent risk tiering pack covering <strong>${count}</strong> in-scope suppliers.`)
        + p(`Each row is one supplier. Answer 1, 2 or 3 in every question column &mdash; the Questions sheet explains what each score means.`)
        + p(`These questions are about <strong>your relationship</strong> with the supplier, not about the supplier's own controls. Only you can answer them.`);

    return {
        subject: `Inherent risk tiering pack for ${vars.tenantName || "your organisation"}`,
        html: buildShell({
            preheader: `The tiering pack for ${vars.tenantName || "your organisation"} covers ${count} suppliers.`,
            eyebrow: "Third Party Risk Management",
            heroEmoji: "\u{1F4CA}",
            heroTitle: "Inherent risk tiering pack",
            heroSub: `${count} in-scope suppliers, one row each.`,
            bodyHtml,
            noteHtml: `Answer 1, 2 or 3 in every column. Any questions, write to ${contactLink}.`,
        }),
        text: `Hello,\n\nAttached is the tiering pack covering ${count} in-scope suppliers.\n\n`
            + `Each row is one supplier. Answer 1, 2 or 3 in every question column.\n\n`
            + `These questions are about YOUR relationship with the supplier, not about the `
            + `supplier's own controls.\n\n`
            + `If you have any questions, please contact ${CONTACT}.\n\n`
            + `Regards\nThird Party Risk Management\nDolluz Corp`,
    };
}

/* ------------------------------------------------- supplier questionnaire */

/** vars: { vendorName, tenantName, days, reminder? } */
function renderVendorQuestionnaireEmail(vars = {}) {
    const vendor = esc(vars.vendorName || "your organisation");
    const tenant = esc(vars.tenantName || "our client");
    const days = Number(vars.days || 14);
    const reminder = !!vars.reminder;

    const bodyHtml =
        p(`Hello,`)
        + p(`${tenant} has engaged Dolluz Corp to assess the information security controls of its third parties. <strong>${vendor}</strong> is one of them.`)
        + p(`Attached is a questionnaire specific to your organisation. Please:`)
        + `<ol style="font-size:14px;line-height:1.9;margin:0 0 14px;padding-left:20px;color:#374151">
             <li>Choose a position for every control from the dropdown</li>
             <li>Attach supporting evidence for each answer</li>
             <li>Return the completed workbook within <strong>${days} days</strong></li>
           </ol>`
        + detailRow(
            `<strong style="color:#0D1B2A">${vendor}</strong> <span style="color:#94A3B8;font-size:13px">(${tenant})</span>`,
            `<span style="font-size:13px;color:#64748B">Return within ${days} days</span>`)
        + p(`Please return the file you were sent rather than a copy of a blank template. It carries an identity marker that lets us match it back to your organisation automatically.`);

    return {
        subject: reminder
            ? `Reminder: security questionnaire for ${vars.vendorName || "your organisation"}`
            : `Security questionnaire for ${vars.vendorName || "your organisation"}`,
        html: buildShell({
            preheader: reminder
                ? `A reminder that the security questionnaire for ${vars.vendorName || ""} is still outstanding.`
                : `${vars.tenantName || "Our client"} has asked us to assess the controls at ${vars.vendorName || ""}.`,
            eyebrow: "Third Party Risk Management",
            heroEmoji: reminder ? "\u{23F0}" : "\u{1F510}",
            heroTitle: reminder ? "Questionnaire still outstanding" : "Security questionnaire",
            heroSub: `An answer with no supporting evidence is recorded as Not Evidenced.`,
            bodyHtml,
            noteHtml: `An answer with no supporting evidence is recorded as <strong>Not Evidenced</strong> and scored accordingly. Any questions, write to ${contactLink}.`,
        }),
        text: `Hello,\n\n${vars.tenantName || ""} has engaged Dolluz Corp to assess the information `
            + `security controls of its third parties. ${vars.vendorName || ""} is one of them.\n\n`
            + `Attached is a questionnaire specific to your organisation. Please:\n`
            + `  1. Choose a position for every control from the dropdown\n`
            + `  2. Attach supporting evidence for each answer\n`
            + `  3. Return the completed workbook within ${days} days\n\n`
            + `An answer with no supporting evidence is recorded as Not Evidenced.\n\n`
            + `If you have any questions, please contact ${CONTACT}.\n\n`
            + `Regards\nThird Party Risk Management\nDolluz Corp`,
    };
}

/* ------------------------------------------------------------ report issue */

/** vars: { tenantName, vendorName, reference, portalUrl? } */
function renderReportIssueEmail(vars = {}) {
    const tenant = esc(vars.tenantName || "the client");
    const vendor = esc(vars.vendorName || "the supplier");
    const ref = esc(vars.reference || "");
    const portal = vars.portalUrl
        ? cta(vars.portalUrl, "View the report &rarr;")
        : "";

    const bodyHtml =
        p(`Hello,`)
        + p(`The third party assessment report for <strong>${vendor}</strong> has been approved and issued to ${tenant}.`)
        + detailRow(
            `<strong style="color:#0D1B2A">${vendor}</strong> <span style="color:#94A3B8;font-size:13px">(${ref})</span>`,
            portal)
        + p(`This report is confidential and is intended for ${tenant} only.`);

    return {
        subject: `Third party assessment report ${vars.reference || ""} - ${vars.vendorName || ""}`,
        html: buildShell({
            preheader: `The assessment report for ${vars.vendorName || ""} has been issued to ${vars.tenantName || ""}.`,
            eyebrow: "Third Party Risk Management",
            heroEmoji: "\u{1F4D1}",
            heroTitle: "Assessment report issued",
            heroSub: `${vendor} &mdash; document reference ${ref}`,
            bodyHtml,
            noteHtml: `This report is confidential. Any questions, write to ${contactLink}.`,
        }),
        text: `Hello,\n\nThe third party assessment report for ${vars.vendorName || ""} has been `
            + `approved and issued to ${vars.tenantName || ""}.\n\nDocument reference: ${vars.reference || ""}\n\n`
            + `This report is confidential and is intended for ${vars.tenantName || ""} only.\n\n`
            + `If you have any questions, please contact ${CONTACT}.\n\n`
            + `Regards\nThird Party Risk Management\nDolluz Corp`,
    };
}

module.exports = {
    renderLoginOtpEmail,
    renderIntakeTemplateEmail,
    renderTieringPackEmail,
    renderVendorQuestionnaireEmail,
    renderReportIssueEmail,
};
