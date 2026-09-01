// Clients (tenants), their methodology dials, engagement role grants, and the
// per-client dashboard.

require("dotenv").config({ quiet: true });
const express = require("express");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requireTenant, requirePerm, memberTenantIds } = require('./utils/tprm_audit');
const scoring = require('./utils/tprm_scoring');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();
const dadmin = getDBConnection('dadmin').promise();

router.use(verifyJWT, tenantScope);

/* ------------------------------------------------------- list my clients */
router.get("/list", async (req, res) => {
    try {
        const ids = memberTenantIds(req);
        if (!ids.length) return res.json([]);
        const [rows] = await db.query(
            `SELECT t.tenant_id, t.tenant_code, t.tenant_name, t.default_sector, t.status,
                    (SELECT COUNT(*) FROM third_party tp
                      WHERE tp.tenant_id = t.tenant_id AND tp.deleted_time IS NULL) AS third_parties,
                    (SELECT COUNT(*) FROM finding f
                      WHERE f.tenant_id = t.tenant_id AND f.status IN ('open','in_progress')) AS open_findings
               FROM tenant t
              WHERE t.tenant_id IN (${ids.map(() => '?').join(',')}) AND t.deleted_time IS NULL
              ORDER BY t.tenant_name`,
            ids
        );
        res.json(rows);
    } catch (e) {
        logError("clients/list", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* --------------------------------------------------- onboard a new client */
router.post("/create", requirePerm('client.create'), async (req, res) => {
    const conn = await db.getConnection();
    try {
        const { tenantCode, tenantName, defaultSector } = req.body;
        if (!tenantCode || !tenantName) {
            return res.status(400).json({ error: "Client name and code are required" });
        }
        const code = String(tenantCode).toUpperCase().trim();
        if (!/^[A-Z0-9]{2,8}$/.test(code)) {
            return res.status(400).json({
                error: "BAD_CODE",
                message: "Client code must be 2 to 8 characters, letters and digits only. It appears in every document reference.",
            });
        }

        await conn.beginTransaction();

        const [dupe] = await conn.query(`SELECT tenant_id FROM tenant WHERE tenant_code = ?`, [code]);
        if (dupe.length) {
            await conn.rollback();
            return res.status(409).json({ error: "CODE_TAKEN", message: `Client code ${code} is already in use` });
        }

        const [r] = await conn.query(
            `INSERT INTO tenant (tenant_code, tenant_name, default_sector, created_by)
             VALUES (?,?,?,?)`,
            [code, String(tenantName).trim(), defaultSector || null, req.emp_id]
        );
        const tenantId = r.insertId;

        // Seed the methodology from the platform defaults so the client is
        // immediately usable and every dial is visible and editable.
        const [domains] = await conn.query(`SELECT domain_code, default_weight FROM control_domain`);
        const domainWeights = {};
        domains.forEach(d => { domainWeights[d.domain_code] = Number(d.default_weight); });

        await conn.query(
            `INSERT INTO tenant_methodology
               (tenant_id, dimension_weights, domain_weights, tier1_threshold, tier2_threshold, sla_json, edited_by)
             VALUES (?,?,?,?,?,?,?)`,
            [tenantId, JSON.stringify(scoring.DEFAULT_DIMENSION_WEIGHTS), JSON.stringify(domainWeights),
             scoring.DEFAULT_TIER1, scoring.DEFAULT_TIER2, JSON.stringify(scoring.DEFAULT_SLA), req.emp_id]
        );

        // The creator becomes Engagement Manager on their own new client,
        // otherwise they would immediately lose sight of what they just made.
        // On first run they get Practice Head instead: the very first person
        // in has to be able to set the methodology and grant everyone else.
        const firstRole = req.setupMode ? 'PH' : 'EM';
        const [[role]] = await conn.query(
            `SELECT role_id FROM tprm_role WHERE role_code = ?`, [firstRole]);
        if (role) {
            await conn.query(
                `INSERT IGNORE INTO tprm_user_tenant_role (emp_id, tenant_id, role_id, granted_by)
                 VALUES (?,?,?,?)`,
                [req.emp_id, tenantId, role.role_id, req.emp_id]
            );
        }

        await conn.commit();
        await audit(req, {
            action: 'client.created', entity: 'tenant', entityId: tenantId,
            after: { code, name: tenantName }, tenantId,
        });
        res.status(201).json({ success: true, tenant_id: tenantId, tenant_code: code });
    } catch (e) {
        await conn.rollback().catch(() => {});
        logError("clients/create", e, req);
        res.status(500).json({ error: "Database error" });
    } finally {
        conn.release();
    }
});

/* -------------------------------------------------- per-client dashboard */
router.get("/:tenantId/dashboard", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;
        const tid = req.tenantId;

        const [[kpi]] = await db.query(
            `SELECT
               (SELECT COUNT(*) FROM third_party WHERE tenant_id=? AND deleted_time IS NULL) AS third_parties,
               (SELECT COUNT(*) FROM assessment WHERE tenant_id=? AND tier=1) AS tier1_total,
               (SELECT COUNT(*) FROM assessment WHERE tenant_id=? AND tier=1
                  AND state IN ('approved','issued','closed')) AS tier1_done,
               (SELECT COUNT(*) FROM finding WHERE tenant_id=? AND severity='Critical'
                  AND status IN ('open','in_progress')) AS open_critical,
               (SELECT COUNT(*) FROM finding WHERE tenant_id=? AND status IN ('open','in_progress')
                  AND due_at < CURDATE()) AS breached`,
            [tid, tid, tid, tid, tid]
        );
        const [tiers] = await db.query(
            `SELECT tier, COUNT(*) AS n FROM assessment
              WHERE tenant_id=? AND tier IS NOT NULL GROUP BY tier ORDER BY tier`, [tid]);
        const [exposure] = await db.query(
            `SELECT COALESCE(s.sector_name, 'Unclassified') AS sector, COUNT(*) AS n
               FROM third_party tp LEFT JOIN sector s ON s.sector_code = tp.sector_code
              WHERE tp.tenant_id=? AND tp.deleted_time IS NULL
              GROUP BY s.sector_name ORDER BY n DESC LIMIT 10`, [tid]);
        const [states] = await db.query(
            `SELECT state, COUNT(*) AS n FROM assessment WHERE tenant_id=? GROUP BY state`, [tid]);
        const [severity] = await db.query(
            `SELECT severity, COUNT(*) AS n FROM finding
              WHERE tenant_id=? AND status IN ('open','in_progress')
              GROUP BY severity
              ORDER BY FIELD(severity,'Critical','High','Medium','Low')`, [tid]);

        kpi.tier1_coverage_pct = Number(kpi.tier1_total) > 0
            ? Math.round((Number(kpi.tier1_done) / Number(kpi.tier1_total)) * 100) : 0;

        res.json({ kpi, tiers, exposure, states, severity });
    } catch (e) {
        logError("clients/dashboard", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------------------------------------- the methodology */
router.get("/:tenantId/methodology", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [[m]] = await db.query(`SELECT * FROM tenant_methodology WHERE tenant_id=?`, [req.tenantId]);
        const [dimensions] = await db.query(
            `SELECT dimension_code, dimension_name, default_weight, note FROM tiering_dimension ORDER BY sort_order`);
        const [domains] = await db.query(
            `SELECT domain_code, domain_name, default_weight FROM control_domain ORDER BY sort_order`);

        res.json({
            dimensions, domains,
            dimensionWeights: scoring.jsonOf(m && m.dimension_weights, scoring.DEFAULT_DIMENSION_WEIGHTS),
            domainWeights: scoring.jsonOf(m && m.domain_weights, {}),
            tier1Threshold: m ? Number(m.tier1_threshold) : scoring.DEFAULT_TIER1,
            tier2Threshold: m ? Number(m.tier2_threshold) : scoring.DEFAULT_TIER2,
            sla: scoring.jsonOf(m && m.sla_json, scoring.DEFAULT_SLA),
        });
    } catch (e) {
        logError("clients/methodology", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.put("/:tenantId/methodology", requirePerm('methodology.edit'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const { dimensionWeights, domainWeights, tier1Threshold, tier2Threshold, sla } = req.body;

        // Dimension weights must total 1.00. If they don't, the inherent score
        // silently stops meaning what the thresholds assume it means.
        const total = Object.values(dimensionWeights || {}).reduce((a, b) => a + Number(b), 0);
        if (Math.abs(total - 1) > 0.001) {
            return res.status(400).json({
                error: "WEIGHTS_UNBALANCED",
                message: `Dimension weights must total 1.00, they currently total ${total.toFixed(3)}`,
            });
        }
        if (Number(tier1Threshold) <= Number(tier2Threshold)) {
            return res.status(400).json({
                error: "THRESHOLDS_INVERTED",
                message: "The Tier 1 threshold must be higher than the Tier 2 threshold",
            });
        }

        const [[before]] = await db.query(`SELECT * FROM tenant_methodology WHERE tenant_id=?`, [req.tenantId]);

        await db.query(
            `INSERT INTO tenant_methodology
               (tenant_id, dimension_weights, domain_weights, tier1_threshold, tier2_threshold, sla_json, edited_by)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               dimension_weights=VALUES(dimension_weights), domain_weights=VALUES(domain_weights),
               tier1_threshold=VALUES(tier1_threshold), tier2_threshold=VALUES(tier2_threshold),
               sla_json=VALUES(sla_json), edited_by=VALUES(edited_by)`,
            [req.tenantId, JSON.stringify(dimensionWeights), JSON.stringify(domainWeights || {}),
             tier1Threshold, tier2Threshold, JSON.stringify(sla || scoring.DEFAULT_SLA), req.emp_id]
        );

        await audit(req, {
            action: 'methodology.updated', entity: 'tenant_methodology', entityId: req.tenantId,
            before: before || null, after: { dimensionWeights, tier1Threshold, tier2Threshold, sla },
            tenantId: req.tenantId,
        });
        res.json({
            success: true,
            message: "Methodology saved. Assessments already approved keep the scores they were approved on.",
        });
    } catch (e) {
        logError("methodology PUT", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ----------------------------------------------- engagement role grants */
router.get("/roles", async (_req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT role_id, role_code, role_name, rank_value, can_grant, is_client_role, description
               FROM tprm_role ORDER BY rank_value DESC`);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: "Database error" });
    }
});

router.get("/:tenantId/members", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [grants] = await db.query(
            `SELECT utr.id, utr.emp_id, utr.granted_time, r.role_id, r.role_code, r.role_name, r.rank_value
               FROM tprm_user_tenant_role utr
               JOIN tprm_role r ON r.role_id = utr.role_id
              WHERE utr.tenant_id = ? AND utr.revoked_time IS NULL
              ORDER BY r.rank_value DESC`,
            [req.tenantId]
        );
        if (!grants.length) return res.json([]);

        const ids = [...new Set(grants.map(g => g.emp_id))];
        const [emps] = await dadmin.query(
            `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name, emp_mail_id FROM employee
              WHERE emp_id IN (${ids.map(() => '?').join(',')})`, ids);
        const byId = {};
        emps.forEach(e => { byId[e.emp_id] = e; });

        // When each person last completed the code step. A consumed OTP row is
        // the only record of a sign-in that actually succeeded, so it answers
        // the question a Practice Head is really asking about a grant: has this
        // person ever used it? Cheap - one grouped read on an indexed column.
        const [logins] = await db.query(
            `SELECT emp_id, MAX(consumed_at) AS last_login
               FROM tprm_login_otp
              WHERE consumed_at IS NOT NULL AND emp_id IN (${ids.map(() => '?').join(',')})
              GROUP BY emp_id`, ids);
        const lastLogin = {};
        logins.forEach(l => { lastLogin[l.emp_id] = l.last_login; });

        res.json(grants.map(g => ({
            ...g,
            emp_name: byId[g.emp_id] ? byId[g.emp_id].emp_name : '(removed employee)',
            emp_mail_id: byId[g.emp_id] ? byId[g.emp_id].emp_mail_id : null,
            last_login: lastLogin[g.emp_id] || null,
        })));
    } catch (e) {
        logError("members", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/** Employees who could be granted a role but do not have one yet. */
router.get("/:tenantId/grantable-employees", requirePerm('user.grant'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const [existing] = await db.query(
            `SELECT emp_id FROM tprm_user_tenant_role WHERE tenant_id=? AND revoked_time IS NULL`,
            [req.tenantId]);
        const taken = new Set(existing.map(e => String(e.emp_id)));

        const [emps] = await dadmin.query(
            `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name, emp_mail_id FROM employee
              WHERE deleted_time IS NULL AND active = 1 ORDER BY emp_first_name, emp_last_name`);
        res.json(emps.filter(e => !taken.has(String(e.emp_id))));
    } catch (e) {
        logError("grantable-employees", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/:tenantId/members", requirePerm('user.grant'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const { empId, roleId } = req.body;
        if (!empId || !roleId) return res.status(400).json({ error: "Employee and role are both required" });

        const me = req.grants[req.tenantId];
        if (!me.canGrant) {
            return res.status(403).json({ error: "CANNOT_GRANT", message: "Your role cannot grant access on this client" });
        }

        const [[target]] = await db.query(
            `SELECT role_id, role_name, rank_value FROM tprm_role WHERE role_id=?`, [roleId]);
        if (!target) return res.status(404).json({ error: "ROLE_UNKNOWN", message: "That role does not exist" });

        // The delegation ceiling. You may only grant a role at or below your
        // own rank, so an Assessor can never quietly make themselves a
        // Practice Head by way of a colleague.
        if (Number(target.rank_value) > me.rank) {
            return res.status(403).json({
                error: "ABOVE_YOUR_RANK",
                message: `You cannot grant ${target.role_name}, it sits above your own level`,
            });
        }

        await db.query(
            `INSERT INTO tprm_user_tenant_role (emp_id, tenant_id, role_id, granted_by)
             VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE revoked_time=NULL, revoked_by=NULL, granted_by=VALUES(granted_by),
               granted_time=NOW(3)`,
            [empId, req.tenantId, roleId, req.emp_id]
        );
        await audit(req, {
            action: 'role.granted', entity: 'tprm_user_tenant_role', entityId: empId,
            after: { role: target.role_name }, tenantId: req.tenantId,
        });
        res.status(201).json({ success: true, message: `${target.role_name} granted` });
    } catch (e) {
        logError("grant role", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.delete("/:tenantId/members/:empId", requirePerm('user.grant'), async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        await db.query(
            `UPDATE tprm_user_tenant_role SET revoked_time=NOW(3), revoked_by=?
              WHERE tenant_id=? AND emp_id=? AND revoked_time IS NULL`,
            [req.emp_id, req.tenantId, req.params.empId]
        );
        await audit(req, {
            action: 'role.revoked', entity: 'tprm_user_tenant_role',
            entityId: req.params.empId, tenantId: req.tenantId,
        });
        res.json({ success: true, message: "Access revoked" });
    } catch (e) {
        logError("revoke role", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

module.exports = router;
