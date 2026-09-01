// Read-only view over tprm_audit_event.
//
// There is deliberately no update or delete endpoint anywhere in this file.
// Grant the application's MySQL user INSERT and SELECT on tprm_audit_event and
// nothing else, so the trail cannot be rewritten even by a compromised app.

require("dotenv").config({ quiet: true });
const express = require("express");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { tenantScope, requireTenant, requirePerm } = require('./utils/tprm_audit');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();
const dadmin = getDBConnection('dadmin').promise();

router.use(verifyJWT, tenantScope);

router.get("/:tenantId/list", requirePerm('audit.read'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const limit = Math.min(Number(req.query.limit) || 200, 1000);
        const params = [req.tenantId];
        let where = `tenant_id = ?`;
        if (req.query.action) { where += ` AND action LIKE ?`; params.push(`${req.query.action}%`); }
        if (req.query.entity) { where += ` AND entity_type = ?`; params.push(req.query.entity); }
        if (req.query.from) { where += ` AND occurred_time >= ?`; params.push(req.query.from); }
        if (req.query.to) { where += ` AND occurred_time <= ?`; params.push(req.query.to); }

        const [rows] = await db.query(
            `SELECT audit_id, actor_emp_id, actor_email, action, entity_type, entity_id,
                    reason, ip_addr, occurred_time, before_json, after_json
               FROM tprm_audit_event
              WHERE ${where}
              ORDER BY occurred_time DESC
              LIMIT ${limit}`,
            params);

        const ids = [...new Set(rows.map(r => r.actor_emp_id).filter(Boolean))];
        let names = {};
        if (ids.length) {
            const [emps] = await dadmin.query(
                `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name FROM employee WHERE emp_id IN (${ids.map(() => '?').join(',')})`, ids);
            emps.forEach(e => { names[e.emp_id] = e.emp_name; });
        }
        rows.forEach(r => { r.actor_name = names[r.actor_emp_id] || r.actor_email || 'System'; });

        res.json(rows);
    } catch (e) {
        logError("audit list", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/** Everything that ever happened to one object, oldest first. */
router.get("/entity/:type/:id", requirePerm('audit.read'), async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT * FROM tprm_audit_event
              WHERE entity_type=? AND entity_id=? ORDER BY occurred_time`,
            [req.params.type, req.params.id]);

        // Only return rows for clients the caller is a member of.
        const mine = new Set(Object.keys(req.grants || {}).map(Number));
        res.json(rows.filter(r => !r.tenant_id || mine.has(Number(r.tenant_id))));
    } catch (e) {
        logError("audit entity", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

module.exports = router;
