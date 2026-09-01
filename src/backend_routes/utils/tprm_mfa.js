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
const signMfaToken = (empId) =>
    jwt.sign({ emp_id: empId, typ: "mfa" }, JWT_SECRET, { expiresIn: "10m" });

/** Returns the emp_id, or null when the token is missing, expired, tampered
 *  with, or is a real session token being passed off as an MFA one. */
function readMfaToken(t) {
    if (!t) return null;
    try {
        const p = jwt.verify(t, JWT_SECRET);
        return p && p.typ === "mfa" ? p.emp_id : null;
    } catch {
        return null;
    }
}

module.exports = {
    OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS, MAX_ATTEMPTS, MAX_SENDS,
    sha256, newOtp, codeMatches, maskEmail,
    signMfaToken, readMfaToken,
};
