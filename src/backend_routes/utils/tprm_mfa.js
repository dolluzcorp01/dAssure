// Two factor: the emailed six digit code, and the short-lived token that
// carries a half-finished sign-in from the password step to the code step.
//
// The rule the product is built on: a password alone never issues a session.
// /Verifylogin proves who you are, mails a code and hands back an mfaToken;
// only /mfa/verify sets the dTprm_token cookie. That is why the mfaToken is a
// different token type, signed with the same secret but carrying typ:'mfa' -
// it is rejected everywhere a real session token is expected.

require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

/** How long a mailed code is good for. Shown as a countdown on the screen, so
 *  changing it here changes what the user sees without any other edit. */
const OTP_TTL_SECONDS = 120;

/** How long before "Resend code" becomes clickable again. Stops the button
 *  being used to post mail at somebody. */
const RESEND_COOLDOWN_SECONDS = 30;

/** Wrong codes allowed against one code before it is burned. */
const MAX_ATTEMPTS = 3;

/** Codes mailed in one sign-in attempt before the person starts over. */
const MAX_SENDS = 5;

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

/**
 * A six digit code, from the cryptographic RNG rather than Math.random.
 * Leading zeros are kept: '004182' is a perfectly good code, and dropping it
 * to '4182' would quietly shrink the keyspace.
 */
function newOtp() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Compares without leaking, by length, where the first difference was. */
function codeMatches(entered, storedHash) {
    if (!entered || !storedHash) return false;
    const a = Buffer.from(sha256(String(entered).trim()), "utf8");
    const b = Buffer.from(String(storedHash), "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * 'pavithran@dolluzcorp.com' -> 'p*******n@dolluzcorp.com'
 *
 * Enough for the person to recognise their own address and spot a typo in it,
 * not enough to hand a full address to whoever is standing behind them.
 */
function maskEmail(email) {
    const s = String(email || "");
    const at = s.indexOf("@");
    if (at < 1) return s;
    const name = s.slice(0, at);
    const domain = s.slice(at);
    if (name.length <= 2) return name[0] + "*" + domain;
    return name[0] + "*".repeat(name.length - 2) + name[name.length - 1] + domain;
}

/* --------------------------------------------------- the half-way token */

/** Signed after the password is accepted. Ten minutes covers a couple of
 *  resends of a two minute code; the code's own expiry is the tight one. */
const signMfaToken = (empId, remember) =>
    jwt.sign({ emp_id: empId, typ: "mfa", rm: !!remember }, JWT_SECRET, { expiresIn: "10m" });

/** Returns the emp_id, or null when the token is missing, expired, tampered
 *  with, or is a real session token being passed off as an MFA one. */
function readMfaToken(t) {
    const c = readMfaClaims(t);
    return c ? c.empId : null;
}

/** The same check, keeping the remember flag. It rides in the token rather
 *  than being re-sent with the code, so the browser cannot turn it on between
 *  the password step and the code step. */
function readMfaClaims(t) {
    if (!t) return null;
    try {
        const p = jwt.verify(t, JWT_SECRET);
        if (!p || p.typ !== "mfa") return null;
        return { empId: p.emp_id, remember: !!p.rm };
    } catch {
        return null;
    }
}

/* ------------------------------------------- password reset step tokens */

/**
 * The reset flow has two gaps a browser has to carry state across: from the
 * address to the code, and from the code to the new password. Each gap gets
 * its own token TYPE, signed with the same secret.
 *
 * The types are what stop the tokens being swapped. A 'reset' token proves
 * only that an address was submitted - it must never be enough to set a
 * password. A 'pwd' token is minted only on the far side of a redeemed code,
 * and only it opens the final step. readStepToken refuses anything whose typ
 * does not match, so a session token or an MFA token presented here is not a
 * key to anything.
 */
const signStepToken = (empId, typ, minutes) =>
    jwt.sign({ emp_id: empId, typ }, JWT_SECRET, { expiresIn: `${minutes}m` });

function readStepToken(t, typ) {
    if (!t) return null;
    try {
        const p = jwt.verify(t, JWT_SECRET);
        if (!p || p.typ !== typ) return null;
        return p.emp_id;
    } catch {
        return null;
    }
}

/* --------------------------------------------------- remembered accounts */

/** How long a remembered account skips the code for. */
const TRUST_DAYS = 14;

/** Is this account inside a live remember window?
 *
 *  Keyed on emp_id alone: no cookie, agent or address is consulted, so the
 *  answer is the same in every browser on every machine. That is the asked-for
 *  behaviour, and it is why this is second factor off for the window rather
 *  than a remembered device. */
async function trustedUntil(db, empId) {
    const [[row]] = await db.query(
        `SELECT trusted_until FROM tprm_mfa_trust
          WHERE emp_id = ? AND revoked_time IS NULL AND trusted_until > NOW(3)`, [empId]);
    return row ? row.trusted_until : null;
}

/** Starts or extends the window. Called only after a code has been redeemed,
 *  so the window can never open without a second factor having been passed. */
async function rememberAccount(db, empId, ip, agent) {
    await db.query(
        `INSERT INTO tprm_mfa_trust (emp_id, trusted_until, granted_ip, granted_agent)
         VALUES (?, DATE_ADD(NOW(3), INTERVAL ? DAY), ?, ?)
         ON DUPLICATE KEY UPDATE
           trusted_until = VALUES(trusted_until), granted_time = NOW(3),
           granted_ip = VALUES(granted_ip), granted_agent = VALUES(granted_agent),
           revoked_time = NULL`,
        [empId, TRUST_DAYS, ip || null, (agent || '').slice(0, 255) || null]);
}

/** Ends it everywhere at once - the only way back to a code prompt before the
 *  window runs out. */
async function forgetAccount(db, empId) {
    await db.query(
        `UPDATE tprm_mfa_trust SET revoked_time = NOW(3)
          WHERE emp_id = ? AND revoked_time IS NULL`, [empId]);
}

module.exports = {
    OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS, MAX_ATTEMPTS, MAX_SENDS, TRUST_DAYS,
    sha256, newOtp, codeMatches, maskEmail,
    readMfaClaims, trustedUntil, rememberAccount, forgetAccount,
    signMfaToken, readMfaToken,
    signStepToken, readStepToken,
};
