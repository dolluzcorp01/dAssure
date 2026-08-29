// Sign-in for dTprm.
//
// Identity is NOT duplicated. Staff sign in with the same dadmin.employee
// credentials they use for every other dApp, and the JWT_SECRET is shared, so
// the token minted here is the same shape as dAdmin's.
//
// What IS specific to dTprm is the engagement role: which client you may work
// on and in what capacity. That lives in tprm.tprm_user_tenant_role and is
// resolved on every request by tenantScope, never trusted from the token.

require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const getDBConnection = require('../../config/db');
const { grantsFor, audit } = require('./utils/tprm_audit');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const dadmin = getDBConnection('dadmin').promise();
const tprm = getDBConnection(process.env.DB_NAME || 'dtprm').promise();

const JWT_SECRET = process.env.JWT_SECRET;
const isProd = process.env.NODE_ENV === "production";

// 🔹 Middleware to verify JWT. Accepts the shared dolluzcorp_token so a user
// already signed into Inside D lands here without signing in twice.
const verifyJWT = (req, res, next) => {
    const token = req.cookies.dTprm_token || req.cookies.dolluzcorp_token;
    if (!token) {
        return res.status(403).json({ message: 'Access Denied. No Token Provided!' });
    }
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ message: 'Invalid Token' });
        req.emp_id = decoded.emp_id;
        next();
    });
};

const cookieOptions = () => ({
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    domain: isProd ? ".dolluzcorp.com" : undefined,
});

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
        const grants = await grantsFor(employee.emp_id);
        if (!Object.keys(grants).length) {
            return res.status(403).json({
                message: "NO_ENGAGEMENT",
                detail: "You have not been assigned to a client engagement in dTprm yet. "
                    + "Ask a Practice Head or Engagement Manager to grant you a role.",
            });
        }

        const token = jwt.sign({ emp_id: employee.emp_id }, JWT_SECRET, { expiresIn: '12h' });
        res.cookie("dTprm_token", token, cookieOptions());

        req.emp_id = employee.emp_id;
        req.tprmUser = employee;
        await audit(req, { action: 'auth.login', entity: 'employee', entityId: employee.emp_id });

        return res.json({ success: true, message: "Login successful" });
    } catch (e) {
        logError("dTprm login error", e, req);
        return res.status(500).json({ message: "Database error" });
    }
});

/* ---------------------------------------------------------------- logout */
router.post("/logout", (req, res) => {
    res.clearCookie("dTprm_token", cookieOptions());
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
