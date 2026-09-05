// Sign-in for dAssure.
//
// Identity is NOT duplicated. Staff sign in with the same dadmin.employee
// credentials they use for every other dApp, and the JWT_SECRET is shared, so
// the token minted here is the same shape as dAdmin's.
//
// What IS specific to dAssure is the engagement role: which client you may work
// on and in what capacity. That lives in tprm.tprm_user_tenant_role and is
// resolved on every request by tenantScope, never trusted from the token.
//
// Also specific to dAssure is the second factor. A password alone never issues
// a session here: /Verifylogin proves the password, mails a six digit code and
// returns a short lived mfaToken. Only /mfa/verify sets the dTprm_token
// cookie.
//
// The one way past the code step is "Remember for 14 days". Read what that
// does before relying on it: the window is recorded against the ACCOUNT, not
// against a device or a browser, so once it is open the password alone signs
// in from anywhere. It is not a remembered device - it is the second factor
// switched off for fourteen days. See 015_mfa_trust.sql.

require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const getDBConnection = require('../../config/db');
const { grantsFor, audit, inSetupMode, tenantScope, requireTenant } = require('./utils/tprm_audit');
const { logError } = require('./utils/tprm_log');
const mailer = require('./utils/tprm_mailer');
const {
    OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS, MAX_ATTEMPTS, MAX_SENDS,
    sha256, newOtp, codeMatches, maskEmail, signMfaToken, readMfaToken,
    readMfaClaims, trustedUntil, rememberAccount, forgetAccount, TRUST_DAYS,
    signStepToken, readStepToken,
} = require('./utils/tprm_mfa');

const router = express.Router();
const dadmin = getDBConnection('dadmin').promise();
const tprm = getDBConnection(process.env.DB_NAME || 'dtprm').promise();

const JWT_SECRET = process.env.JWT_SECRET;
const isProd = process.env.NODE_ENV === "production";

// 🔹 Middleware to verify JWT.
//
// Only a dTprm_token that completed the code step is a session here. The
// shared dolluzcorp_token still proves identity - someone already signed into
// dAdmin or Inside D does not retype their password - but it has not passed
// this product's second factor, so it is answered with MFA_REQUIRED and the
// sign-in screen resumes at the code step. Without that rule the OTP gate
// would be bypassable by anyone holding a cookie from a sibling app.
const verifyJWT = (req, res, next) => {
    const own = req.cookies.dTprm_token;
    if (own) {
        return jwt.verify(own, JWT_SECRET, (err, decoded) => {
            if (err) return res.status(403).json({ message: 'Invalid Token' });
            // Sessions minted before two factor existed carry no mfa claim.
            // They are not trusted; the holder signs in again once.
            if (!decoded.mfa) {
                return res.status(401).json({
                    error: 'MFA_REQUIRED',
                    message: 'Two factor verification is required to continue',
                });
            }
            req.emp_id = decoded.emp_id;
            next();
        });
    }

    const shared = req.cookies.dolluzcorp_token;
    if (!shared) {
        return res.status(403).json({ message: 'Access Denied. No Token Provided!' });
    }
    jwt.verify(shared, JWT_SECRET, (err) => {
        if (err) return res.status(403).json({ message: 'Invalid Token' });
        return res.status(401).json({
            error: 'MFA_REQUIRED',
            message: 'Two factor verification is required to continue',
        });
    });
};

const cookieOptions = () => ({
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    domain: isProd ? ".dolluzcorp.com" : undefined,
});

/* ----------------------------------------------------------- helpers */

async function employeeById(empId) {
    const [rows] = await dadmin.query(
        `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name,
                emp_mail_id, emp_access_level, active
           FROM employee WHERE emp_id = ? AND deleted_time IS NULL`,
        [empId]
    );
    return rows[0] || null;
}

/** The one code of THIS KIND that can still be redeemed, if there is one.
 *
 *  Scoped by purpose. Sign-in and password reset both mail six digit codes to
 *  the same person through the same table, and a code issued for one must
 *  never open the other - so the purpose is part of the lookup, not something
 *  the caller is trusted to remember. */
async function liveOtpFor(empId, purpose = 'login') {
    const [rows] = await tprm.query(
        `SELECT otp_id, code_hash, expires_at, attempts, send_no, created_time
           FROM tprm_login_otp
          WHERE emp_id = ? AND purpose = ?
            AND consumed_at IS NULL AND superseded_at IS NULL
          ORDER BY otp_id DESC LIMIT 1`, [empId, purpose]);
    return rows[0] || null;
}

const secondsUntil = (t) => Math.max(0, Math.ceil((new Date(t) - Date.now()) / 1000));
const secondsSince = (t) => Math.max(0, Math.floor((Date.now() - new Date(t)) / 1000));

/**
 * Mails a fresh code and returns what the screen needs to draw its countdown.
 *
 * Every earlier unconsumed code for this person is superseded first, so a
 * resend does not leave two working codes in the wild - the newest is the only
 * one that opens the door.
 */
async function sendOtp(req, employee, sendNo = 1, purpose = 'login') {
    const code = newOtp();

    // Only codes of the same purpose are superseded: asking to reset a
    // password should not quietly kill a sign-in code already in flight.
    await tprm.query(
        `UPDATE tprm_login_otp SET superseded_at = NOW(3)
          WHERE emp_id = ? AND purpose = ?
            AND consumed_at IS NULL AND superseded_at IS NULL`,
        [employee.emp_id, purpose]);

    const [ins] = await tprm.query(
        `INSERT INTO tprm_login_otp
           (emp_id, purpose, code_hash, expires_at, send_no, ip_addr, user_agent)
         VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND), ?, ?, ?)`,
        [
            employee.emp_id, purpose, sha256(code), OTP_TTL_SECONDS, sendNo,
            (req.ip || '').replace('::ffff:', '').slice(0, 45),
            (req.headers['user-agent'] || '').slice(0, 300),
        ]);

    // The code goes by mail and is never returned to the caller. With
    // driver=outbox the row is written to tprm_mail_outbox and printed in the
    // terminal, code and all, which is how it is read in development.
    const t = purpose === 'reset'
        ? mailer.templates.renderPasswordResetOtpEmail(
            { code, minutes: Math.round(OTP_TTL_SECONDS / 60) })
        : mailer.templates.renderLoginOtpEmail(
            { code, minutes: Math.round(OTP_TTL_SECONDS / 60) });
    const mailId = await mailer.queue({
        to: employee.emp_mail_id,
        subject: t.subject,
        body: t.text,
        html: t.html,
        kind: purpose === 'reset' ? 'password_reset_otp' : 'login_otp',
        empId: employee.emp_id,
        expires: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toTimeString().slice(0, 8),
    });
    await tprm.query(`UPDATE tprm_login_otp SET mail_id = ? WHERE otp_id = ?`,
        [mailId, ins.insertId]);

    return {
        maskedEmail: maskEmail(employee.emp_mail_id),
        expiresIn: OTP_TTL_SECONDS,
        resendIn: RESEND_COOLDOWN_SECONDS,
        sendNo,
        sendsLeft: MAX_SENDS - sendNo,
    };
}

/**
 * The only place a dAssure session is created. The mfa claim is what verifyJWT
 * checks for, so a token minted anywhere else - including by a sibling dApp
 * sharing JWT_SECRET - does not open this product.
 */
async function issueSession(req, res, employee, action) {
    const token = jwt.sign(
        { emp_id: employee.emp_id, mfa: true }, JWT_SECRET, { expiresIn: '12h' });
    res.cookie("dTprm_token", token, cookieOptions());
    res.clearCookie("dTprm_signedout", cookieOptions());
    req.emp_id = employee.emp_id;
    req.tprmUser = employee;
    await audit(req, { action, entity: 'employee', entityId: employee.emp_id });
}

/* --------------------------------------------------------------- sign in */
router.post("/Verifylogin", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: "Username and password required" });
        }

        const [rows] = await dadmin.query(
            `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name, emp_mail_id, account_pass, emp_access_level, active, deleted_time
               FROM employee WHERE emp_mail_id = ? AND deleted_time IS NULL`,
            [username]
        );

        // Deliberately distinct codes here, matching the other dApps, so the
        // login screen can tell the user which field to fix.
        if (!rows.length) return res.status(404).json({ message: "EMAIL_NOT_FOUND" });

        const employee = rows[0];
        if (!employee.account_pass) {
            return res.status(401).json({ message: "Access denied. Account password is missing." });
        }
        if (!employee.active) {
            return res.status(403).json({ message: "Access denied. This account is inactive." });
        }
        if (!bcrypt.compareSync(password, employee.account_pass)) {
            return res.status(401).json({ message: "INVALID_CREDENTIALS" });
        }

        // dAssure access is the engagement grant itself. No grant on any client
        // means there is nothing here for you, whatever your dAdmin role is.
        // Checked before the code is mailed: there is no point sending someone
        // a code for a door that will not open.
        const grants = await grantsFor(employee.emp_id);
        // No grant is normally the end of the road. The exception is a system
        // that has never been set up, where a dAdmin administrator is let in
        // to create the first client - which grants them a role and closes
        // this door behind them.
        if (!Object.keys(grants).length && !(await inSetupMode(employee.emp_id))) {
            return res.status(403).json({
                message: "NO_ENGAGEMENT",
                detail: "You have not been assigned to a client engagement in dAssure yet. "
                    + "Ask a Practice Head or Engagement Manager to grant you a role.",
            });
        }

        // The password is right and there is somewhere to go.
        req.emp_id = employee.emp_id;
        req.tprmUser = employee;
        await audit(req, { action: 'auth.password_ok', entity: 'employee', entityId: employee.emp_id });

        /* A live remember window signs in on the password alone. The window is
           held against the account, so this is reached from any browser on any
           machine - which is the point of it, and the whole of its cost. It is
           audited separately from a normal login so the trail shows plainly
           which sessions were opened without a second factor. */
        const until = await trustedUntil(tprm, employee.emp_id);
        if (until) {
            await issueSession(req, res, employee, 'auth.login_remembered');
            return res.json({ next: "done", trustedUntil: until });
        }

        // Otherwise step two is not optional, so nothing is set on the browser
        // yet - the caller gets a token that is only good for the code step,
        // and the code goes by mail. The remember choice rides in that token
        // rather than being re-sent with the code.
        const sent = await sendOtp(req, employee, 1);
        return res.json({
            next: "mfa",
            mfaToken: signMfaToken(employee.emp_id, req.body.remember),
            ...sent,
        });
    } catch (e) {
        logError("dAssure login error", e, req);
        return res.status(500).json({ message: "Database error" });
    }
});

/* ------------------------------------------------------------ two factor */

// Resume the code step for someone already signed into a sibling dApp.
//
// verifyJWT answers the shared dolluzcorp_token with MFA_REQUIRED, which
// bounces the browser to the sign-in screen. Without this the person would be
// stuck retyping a password they have already given, so the screen probes
// here on load and jumps straight to the code step when identity is proven.
router.post("/mfa/resume", async (req, res) => {
    try {
        // Signing out is a deliberate act. The shared cookie is still there -
        // clearing it would sign the person out of every other dApp, which is
        // not what they asked for - so a marker records the intent and this
        // route stays quiet until someone signs in properly again.
        if (req.cookies.dTprm_signedout) return res.status(401).json({ message: "NO_SESSION" });

        const shared = req.cookies.dolluzcorp_token || req.cookies.dTprm_token;
        if (!shared) return res.status(401).json({ message: "NO_SESSION" });

        let empId = null;
        try { empId = jwt.verify(shared, JWT_SECRET).emp_id; }
        catch { return res.status(401).json({ message: "NO_SESSION" }); }

        const employee = await employeeById(empId);
        if (!employee || !employee.active) return res.status(401).json({ message: "NO_SESSION" });

        const grants = await grantsFor(empId);
        if (!Object.keys(grants).length && !(await inSetupMode(empId))) {
            return res.status(403).json({ message: "NO_ENGAGEMENT" });
        }

        // A code already in flight is reused rather than replaced, so a page
        // refresh does not post a second email and does not reset the clock.
        req.emp_id = empId;
        const live = await liveOtpFor(empId);
        if (live && secondsUntil(live.expires_at) > 0) {
            return res.json({
                next: "mfa",
                mfaToken: signMfaToken(empId),
                maskedEmail: maskEmail(employee.emp_mail_id),
                expiresIn: secondsUntil(live.expires_at),
                resendIn: Math.max(0, RESEND_COOLDOWN_SECONDS - secondsSince(live.created_time)),
                sendNo: live.send_no,
                sendsLeft: MAX_SENDS - live.send_no,
            });
        }
        const sent = await sendOtp(req, employee, 1);
        return res.json({ next: "mfa", mfaToken: signMfaToken(empId), ...sent });
    } catch (e) {
        logError("mfa/resume error", e, req);
        return res.status(500).json({ message: "Database error" });
    }
});

// Send another code. Throttled two ways: a cooldown between sends, and a cap
// on how many one sign-in attempt may post.
router.post("/mfa/resend", async (req, res) => {
    try {
        const empId = readMfaToken(req.body && req.body.mfaToken);
        if (!empId) return res.status(401).json({ message: "MFA_TOKEN_INVALID" });

        const employee = await employeeById(empId);
        if (!employee || !employee.active) return res.status(403).json({ message: "ACCOUNT_INACTIVE" });

        const live = await liveOtpFor(empId);
        const [[last]] = await tprm.query(
            `SELECT send_no, created_time FROM tprm_login_otp
              WHERE emp_id = ? AND purpose = 'login'
              ORDER BY otp_id DESC LIMIT 1`, [empId]);

        if (last) {
            const wait = RESEND_COOLDOWN_SECONDS - secondsSince(last.created_time);
            if (wait > 0) {
                return res.status(429).json({ message: "RESEND_TOO_SOON", resendIn: wait });
            }
        }
        // The counter only climbs while a code is still live. Once one has
        // expired the attempt is over and the next send starts from one, so a
        // slow afternoon of legitimate sign-ins never hits the cap.
        const nextNo = live && secondsUntil(live.expires_at) > 0 ? Number(live.send_no) + 1 : 1;
        if (nextNo > MAX_SENDS) {
            return res.status(429).json({ message: "RESEND_LIMIT" });
        }

        req.emp_id = empId;
        req.tprmUser = employee;
        const sent = await sendOtp(req, employee, nextNo);
        await audit(req, { action: 'auth.otp_resent', entity: 'employee', entityId: empId,
            reason: `send ${nextNo} of ${MAX_SENDS}` });
        return res.json(sent);
    } catch (e) {
        logError("mfa/resend error", e, req);
        return res.status(500).json({ message: "Database error" });
    }
});

// The second step. Three wrong codes burn the code, not the account: the
// person asks for another one rather than being locked out of the product.
router.post("/mfa/verify", async (req, res) => {
    try {
        const { mfaToken, code } = req.body || {};
        const claims = readMfaClaims(mfaToken);
        if (!claims) return res.status(401).json({ message: "MFA_TOKEN_INVALID" });
        const empId = claims.empId;

        const live = await liveOtpFor(empId);
        if (!live) return res.status(400).json({ message: "OTP_NOT_SENT" });

        if (secondsUntil(live.expires_at) <= 0) {
            await tprm.query(`UPDATE tprm_login_otp SET superseded_at = NOW(3) WHERE otp_id = ?`,
                [live.otp_id]);
            return res.status(410).json({ message: "OTP_EXPIRED" });
        }

        if (!codeMatches(code, live.code_hash)) {
            const n = Number(live.attempts) + 1;
            if (n >= MAX_ATTEMPTS) {
                await tprm.query(
                    `UPDATE tprm_login_otp SET attempts = ?, superseded_at = NOW(3) WHERE otp_id = ?`,
                    [n, live.otp_id]);
                req.emp_id = empId;
                await audit(req, { action: 'auth.otp_burned', entity: 'employee', entityId: empId });
                return res.status(410).json({ message: "OTP_BURNED" });
            }
            await tprm.query(`UPDATE tprm_login_otp SET attempts = ? WHERE otp_id = ?`,
                [n, live.otp_id]);
            return res.status(401).json({
                message: "MFA_INVALID",
                attemptsLeft: MAX_ATTEMPTS - n,
                expiresIn: secondsUntil(live.expires_at),
            });
        }

        // Consumed before the session is issued, so the same code replayed on a
        // second connection finds nothing left to redeem.
        const [used] = await tprm.query(
            `UPDATE tprm_login_otp SET consumed_at = NOW(3)
              WHERE otp_id = ? AND consumed_at IS NULL`, [live.otp_id]);
        if (!used.affectedRows) return res.status(410).json({ message: "OTP_BURNED" });

        const employee = await employeeById(empId);
        if (!employee || !employee.active) return res.status(403).json({ message: "ACCOUNT_INACTIVE" });

        await issueSession(req, res, employee, 'auth.login');

        /* Only ever opened here, on the far side of a redeemed code, so the
           window cannot start without a second factor having been passed at
           least once. */
        let trustedUntilAt = null;
        if (claims.remember) {
            await rememberAccount(tprm, empId, req.ip,
                req.headers && req.headers['user-agent']);
            trustedUntilAt = await trustedUntil(tprm, empId);
            await audit(req, {
                action: 'auth.remember_granted', entity: 'employee', entityId: empId,
                after: { days: TRUST_DAYS, scope: 'account, any browser' },
            });
        }
        return res.json({
            success: true, message: "Login successful", trustedUntil: trustedUntilAt,
        });
    } catch (e) {
        logError("mfa/verify error", e, req);
        return res.status(500).json({ message: "Database error" });
    }
});



/* ----------------------------------------------------- password reset */
/*
 * Three steps, because the browser has to cross two gaps: address to code,
 * and code to new password. Each gap is carried by its own typed token, so
 * neither can be skipped - proving you typed an address is not proof you
 * redeemed a code, and only a redeemed code mints the token the last step
 * accepts.
 *
 * IMPORTANT, and it is not obvious from in here: the password being changed
 * lives in dadmin.employee, which every Dolluz Corp app authenticates
 * against. A reset done on this screen changes the password for dAdmin,
 * dAssist, dTime and the rest, not just for dAssure. That is the correct
 * behaviour for one shared credential, but it does mean the dAssure database
 * user needs UPDATE on dadmin.employee - SELECT alone is not enough, and the
 * grant in README.md gives only SELECT.
 */

/** Twelve characters with all four kinds. Matches the rule the reference
 *  prototype states on this screen, and it is stricter than nothing, which
 *  is what was being enforced before. */
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
const PASSWORD_HELP = "At least 12 characters, with an upper case letter, a lower case letter, "
    + "a number and a symbol.";

/* Step one. Always answers the same way.
 *
 * The response shape does not vary on whether the account exists, is inactive
 * or holds no engagement, and the masked address is derived from what was
 * TYPED rather than from what is stored - otherwise the difference between a
 * real and an invented address would be readable straight off the screen, and
 * this form would become a way to enumerate staff. Mail is sent only when
 * there is somebody to send it to. */
router.post("/forgot/start", async (req, res) => {
    try {
        const username = String((req.body && req.body.username) || '').trim();
        if (!username || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username)) {
            return res.status(400).json({ message: "Enter your work email address" });
        }

        const [rows] = await dadmin.query(
            `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name,
                    emp_mail_id, active
               FROM employee WHERE emp_mail_id = ? AND deleted_time IS NULL`,
            [username]);
        const employee = rows[0];

        if (employee && employee.active) {
            req.emp_id = employee.emp_id;
            req.tprmUser = employee;
            await sendOtp(req, employee, 1, 'reset');
            await audit(req, {
                action: 'auth.reset_requested', entity: 'employee', entityId: employee.emp_id,
            });
        }

        // Identical either way, including the token: an unknown address gets a
        // perfectly well formed one that simply has no live code behind it.
        return res.json({
            next: "code",
            resetToken: signStepToken(employee ? employee.emp_id : `unknown:${username}`, 'reset', 15),
            maskedEmail: maskEmail(username),
            expiresIn: OTP_TTL_SECONDS,
            resendIn: RESEND_COOLDOWN_SECONDS,
        });
    } catch (e) {
        logError("forgot/start error", e, req);
        return res.status(500).json({ message: "Database error" });
    }
});

/* Step two. Redeem the code, and mint the token that opens the last step. */
router.post("/forgot/verify", async (req, res) => {
    try {
        const { resetToken, code } = req.body || {};
        const empId = readStepToken(resetToken, 'reset');
        if (!empId) return res.status(401).json({ message: "RESET_TOKEN_INVALID" });

        // An address nobody has fails here rather than at step one, so the
        // two cases are indistinguishable until a code is actually guessed.
        const live = String(empId).startsWith('unknown:') ? null : await liveOtpFor(empId, 'reset');
        if (!live) return res.status(400).json({ message: "OTP_NOT_SENT" });

        if (secondsUntil(live.expires_at) <= 0) {
            await tprm.query(`UPDATE tprm_login_otp SET superseded_at = NOW(3) WHERE otp_id = ?`,
                [live.otp_id]);
            return res.status(410).json({ message: "OTP_EXPIRED" });
        }

        if (!codeMatches(code, live.code_hash)) {
            const n = Number(live.attempts) + 1;
            if (n >= MAX_ATTEMPTS) {
                await tprm.query(
                    `UPDATE tprm_login_otp SET attempts = ?, superseded_at = NOW(3) WHERE otp_id = ?`,
                    [n, live.otp_id]);
                req.emp_id = empId;
                await audit(req, { action: 'auth.reset_otp_burned', entity: 'employee', entityId: empId });
                return res.status(410).json({ message: "OTP_BURNED" });
            }
            await tprm.query(`UPDATE tprm_login_otp SET attempts = ? WHERE otp_id = ?`,
                [n, live.otp_id]);
            return res.status(401).json({
                message: "MFA_INVALID",
                attemptsLeft: MAX_ATTEMPTS - n,
                expiresIn: secondsUntil(live.expires_at),
            });
        }

        // Consumed here, not at the password step: a code redeemed twice on
        // two connections must find nothing left the second time.
        const [used] = await tprm.query(
            `UPDATE tprm_login_otp SET consumed_at = NOW(3)
              WHERE otp_id = ? AND consumed_at IS NULL`, [live.otp_id]);
        if (!used.affectedRows) return res.status(410).json({ message: "OTP_BURNED" });

        return res.json({
            next: "password",
            setToken: signStepToken(empId, 'pwd', 10),
            passwordHelp: PASSWORD_HELP,
        });
    } catch (e) {
        logError("forgot/verify error", e, req);
        return res.status(500).json({ message: "Database error" });
    }
});

/* Step three. Set it. */
router.post("/forgot/reset", async (req, res) => {
    try {
        const { setToken, password, confirm } = req.body || {};
        const empId = readStepToken(setToken, 'pwd');
        if (!empId) return res.status(401).json({ message: "SET_TOKEN_INVALID" });

        if (typeof confirm === 'string' && password !== confirm) {
            return res.status(400).json({ message: "PASSWORD_MISMATCH" });
        }
        if (!PASSWORD_RULE.test(String(password || ''))) {
            return res.status(400).json({ message: "PASSWORD_WEAK", detail: PASSWORD_HELP });
        }

        const employee = await employeeById(empId);
        if (!employee || !employee.active) return res.status(403).json({ message: "ACCOUNT_INACTIVE" });

        const hash = bcrypt.hashSync(String(password), 10);
        const [r] = await dadmin.query(
            `UPDATE employee SET account_pass = ? WHERE emp_id = ? AND deleted_time IS NULL`,
            [hash, empId]);
        if (!r.affectedRows) return res.status(500).json({ message: "Database error" });

        /* A reset ends the remember window. Somebody resetting a password is
           usually somebody who thinks it was known - and leaving a live
           fourteen day second factor bypass open across that would hand the
           account to whoever opened the window. */
        await forgetAccount(tprm, empId);

        // And this browser starts over rather than carrying a session minted
        // against the old password.
        res.clearCookie("dTprm_token", cookieOptions());
        res.cookie("dTprm_signedout", "1", cookieOptions());

        req.emp_id = empId;
        req.tprmUser = employee;
        await audit(req, {
            action: 'auth.password_reset', entity: 'employee', entityId: empId,
            after: { rememberWindowRevoked: true },
        });

        return res.json({
            success: true,
            message: "Password changed. Sign in with your new password.",
        });
    } catch (e) {
        logError("forgot/reset error", e, req);
        return res.status(500).json({ message: "Database error" });
    }
});

/* ---------------------------------------------------------------- logout */
router.post("/logout", (req, res) => {
    res.clearCookie("dTprm_token", cookieOptions());
    // Remember that this was deliberate, so the sign-in screen asks for the
    // password again rather than resuming at the code step off the back of a
    // sibling app's cookie. Cleared the moment a session is issued.
    res.cookie("dTprm_signedout", "1", cookieOptions());
    return res.json({ success: true, message: "Logged out successfully" });
});

/* ------------------------------------------------------------------- me */
// One call that returns everything the UI needs to render: the person, the
// clients they can act on, and the exact permission set per client. The
// sidebar is built from this, and every route re-checks server side.
router.get("/me", verifyJWT, async (req, res) => {
    try {
        const [rows] = await dadmin.query(
            `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name, emp_mail_id, emp_access_level, job_position
               FROM employee WHERE emp_id = ? AND deleted_time IS NULL`,
            [req.emp_id]
        );
        if (!rows.length) return res.status(401).json({ message: "That account no longer exists" });

        const grants = await grantsFor(req.emp_id);
        const ids = Object.keys(grants).map(Number);

        let tenants = [];
        if (ids.length) {
            const [t] = await tprm.query(
                `SELECT t.tenant_id, t.tenant_code, t.tenant_name, t.default_sector, t.status,
                        t.contact_name, t.contact_email
                   FROM tenant t
                  WHERE t.tenant_id IN (${ids.map(() => '?').join(',')}) AND t.deleted_time IS NULL
                  ORDER BY t.tenant_name`,
                ids
            );
            tenants = t.map(x => ({
                ...x,
                roles: grants[x.tenant_id].roles,
                roleNames: grants[x.tenant_id].roleNames,
                rank: grants[x.tenant_id].rank,
            }));
        }

        const permissions = {};
        for (const [tid, g] of Object.entries(grants)) permissions[tid] = [...g.perms];

        // First run. Nobody in the whole system holds an engagement, so there is
        // no Practice Head to grant the first one - somebody has to be able to
        // create the first client, and that somebody is a dAdmin administrator.
        // Only worth asking when the caller holds nothing: anyone with a grant
        // is past setup by definition, and this is the same test tenantScope
        // applies to every other request.
        const setupMode = ids.length ? false : await inSetupMode(req.emp_id);

        res.json({ user: rows[0], tenants, permissions, setupMode });
    } catch (e) {
        logError("/me error", e, req);
        res.status(500).json({ message: "Database error" });
    }
});

/* --------------------------------- who can be assigned work on a client */
/* Who can be assigned on one client.
 *
 * This is the only route in the file that reads engagement data rather than
 * the caller's own session, and it was the one place in the application where
 * the client boundary was not enforced. verifyJWT alone accepts the shared
 * Dolluz Corp token, so anyone signed into any of the sibling applications
 * could walk tenant ids and collect the name, work email and role of every
 * person on every engagement - including engagements at clients they had never
 * been near, and while holding no dAssure grant at all.
 *
 * tenantScope brings the caller's grants onto the request and refuses anyone
 * with no engagement; requireTenant then insists the client in the URL is one
 * of theirs. No permission beyond that: knowing who your own colleagues are on
 * a client you work on is not privileged, and the assignment pickers on the
 * assessment page need it. */
router.get("/tenant-members/:tenantId", verifyJWT, tenantScope, async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [grantRows] = await tprm.query(
            `SELECT utr.emp_id, r.role_code, r.role_name, r.rank_value
               FROM tprm_user_tenant_role utr
               JOIN tprm_role r ON r.role_id = utr.role_id
              WHERE utr.tenant_id = ? AND utr.revoked_time IS NULL`,
            [req.params.tenantId]
        );
        if (!grantRows.length) return res.json([]);

        const ids = [...new Set(grantRows.map(g => g.emp_id))];
        const [emps] = await dadmin.query(
            `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name, emp_mail_id FROM employee
              WHERE emp_id IN (${ids.map(() => '?').join(',')}) AND deleted_time IS NULL`,
            ids
        );
        const byId = {};
        emps.forEach(e => { byId[e.emp_id] = e; });

        res.json(grantRows
            .filter(g => byId[g.emp_id])
            .map(g => ({
                emp_id: g.emp_id,
                emp_name: byId[g.emp_id].emp_name,
                emp_mail_id: byId[g.emp_id].emp_mail_id,
                role_code: g.role_code,
                role_name: g.role_name,
                rank_value: g.rank_value,
            })));
    } catch (e) {
        logError("tenant-members error", e, req);
        res.status(500).json({ message: "Database error" });
    }
});

module.exports = { router, verifyJWT };
