// Sign-in for dTprm.
//
// Identity is NOT duplicated. Staff sign in with the same dadmin.employee
// credentials they use for every other dApp, and the JWT_SECRET is shared, so
// the token minted here is the same shape as dAdmin's.
//
// What IS specific to dTprm is the engagement role: which client you may work
// on and in what capacity. That lives in tprm.tprm_user_tenant_role and is
// resolved on every request by tenantScope, never trusted from the token.
//
// Also specific to dTprm is the second factor. A password alone never issues
// a session here: /Verifylogin proves the password, mails a six digit code and
// returns a short lived mfaToken. Only /mfa/verify sets the dTprm_token
// cookie. Two factor is mandatory for every role, so there is no "remember
// this device" and no way to opt out.

require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const getDBConnection = require('../../config/db');
const { grantsFor, audit } = require('./utils/tprm_audit');
const { logError } = require('./utils/tprm_log');
const mailer = require('./utils/tprm_mailer');
const {
    OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS, MAX_ATTEMPTS, MAX_SENDS,
    sha256, newOtp, codeMatches, maskEmail, signMfaToken, readMfaToken,
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

/** The one code that can still be redeemed, if there is one. */
async function liveOtpFor(empId) {
    const [rows] = await tprm.query(
        `SELECT otp_id, code_hash, expires_at, attempts, send_no, created_time
           FROM tprm_login_otp
          WHERE emp_id = ? AND consumed_at IS NULL AND superseded_at IS NULL
          ORDER BY otp_id DESC LIMIT 1`, [empId]);
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
async function sendOtp(req, employee, sendNo = 1) {
    const code = newOtp();

    await tprm.query(
        `UPDATE tprm_login_otp SET superseded_at = NOW(3)
          WHERE emp_id = ? AND consumed_at IS NULL AND superseded_at IS NULL`,
        [employee.emp_id]);

    const [ins] = await tprm.query(
        `INSERT INTO tprm_login_otp
           (emp_id, code_hash, expires_at, send_no, ip_addr, user_agent)
         VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND), ?, ?, ?)`,
        [
            employee.emp_id, sha256(code), OTP_TTL_SECONDS, sendNo,
            (req.ip || '').replace('::ffff:', '').slice(0, 45),
            (req.headers['user-agent'] || '').slice(0, 300),
        ]);

    const t = mailer.templates.renderLoginOtpEmail(
        { code, minutes: Math.round(OTP_TTL_SECONDS / 60) });
    // The mail is queued, never awaited into the response beyond this: with
    // driver=outbox it is written to tprm_mail_outbox and printed in the
    // terminal, code and all, which is how it is read in development.
    const mailId = await mailer.queue({
        to: employee.emp_mail_id,
        subject: t.subject,
        body: t.text,
        html: t.html,
        kind: 'login_otp',
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
 * The only place a dTprm session is created. The mfa claim is what verifyJWT
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

        // dTprm access is the engagement grant itself. No grant on any client
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
                detail: "You have not been assigned to a client engagement in dTprm yet. "
                    + "Ask a Practice Head or Engagement Manager to grant you a role.",
            });
        }

        // The password is right and there is somewhere to go. Step two is not
        // optional, so nothing is set on the browser yet - the caller gets a
        // token that is only good for the code step, and the code goes by mail.
        req.emp_id = employee.emp_id;
        req.tprmUser = employee;
        await audit(req, { action: 'auth.password_ok', entity: 'employee', entityId: employee.emp_id });

        const sent = await sendOtp(req, employee, 1);
        return res.json({ next: "mfa", mfaToken: signMfaToken(employee.emp_id), ...sent });
    } catch (e) {
        logError("dTprm login error", e, req);
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
              WHERE emp_id = ? ORDER BY otp_id DESC LIMIT 1`, [empId]);

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
        const empId = readMfaToken(mfaToken);
        if (!empId) return res.status(401).json({ message: "MFA_TOKEN_INVALID" });

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
        return res.json({ success: true, message: "Login successful" });
    } catch (e) {
        logError("mfa/verify error", e, req);
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
                `SELECT t.tenant_id, t.tenant_code, t.tenant_name, t.default_sector, t.status
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

        res.json({ user: rows[0], tenants, permissions });
    } catch (e) {
        logError("/me error", e, req);
        res.status(500).json({ message: "Database error" });
    }
});

/* --------------------------------- who can be assigned work on a client */
router.get("/tenant-members/:tenantId", verifyJWT, async (req, res) => {
    try {
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
