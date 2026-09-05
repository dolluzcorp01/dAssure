// Clients (tenants), their methodology dials, engagement role grants, and the
// per-client dashboard.

require("dotenv").config({ quiet: true });
const express = require("express");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requireTenant, requirePerm, memberTenantIds,
        permitted } = require('./utils/tprm_audit');
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
            `SELECT t.tenant_id, t.tenant_code, t.tenant_name, t.trading_name, t.status,
                    t.default_sector,
                    -- The stored value is a code. A code is what the database
                    -- joins on; a name is what a person reads.
                    s.sector_name,
                    (SELECT COUNT(*) FROM third_party tp
                      WHERE tp.tenant_id = t.tenant_id AND tp.deleted_time IS NULL) AS third_parties,
                    (SELECT COUNT(*) FROM finding f
                      WHERE f.tenant_id = t.tenant_id AND f.status IN ('open','in_progress')) AS open_findings
               FROM tenant t
               LEFT JOIN sector s ON s.sector_code = t.default_sector
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
        const { tenantCode, tenantName, defaultSector, tradingName, context,
            contactName, contactEmail, weights, tier1, tier2, sla, team } = req.body;
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

        /* The client's own contact. Not a login - there is no external
           principal in dAssure - but it is the address every message that
           has to reach the client is sent to, so it is worth holding once
           rather than retyping at each of the nine stages. Optional here so
           an existing caller is not broken; the wizard insists on it. */
        const contact = String(contactEmail || '').trim().toLowerCase();
        if (contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) {
            return res.status(400).json({
                error: "BAD_CONTACT_EMAIL",
                message: "That is not a valid email address for the client contact.",
            });
        }

        await conn.beginTransaction();

        const [dupe] = await conn.query(`SELECT tenant_id FROM tenant WHERE tenant_code = ?`, [code]);
        if (dupe.length) {
            await conn.rollback();
            return res.status(409).json({ error: "CODE_TAKEN", message: `Client code ${code} is already in use` });
        }

        const [r] = await conn.query(
            `INSERT INTO tenant
               (tenant_code, tenant_name, trading_name, contact_name, contact_email,
                default_sector, context_json, created_by)
             VALUES (?,?,?,?,?,?,?,?)`,
            [code, String(tenantName).trim(), (tradingName || '').trim() || null,
             String(contactName || '').trim() || null, contact || null,
             defaultSector || null, context ? JSON.stringify(context) : null, req.emp_id]
        );
        const tenantId = r.insertId;

        // Seed the methodology from the platform defaults so the client is
        // immediately usable and every dial is visible and editable.
        const [domains] = await conn.query(`SELECT domain_code, default_weight FROM control_domain`);
        const domainWeights = {};
        domains.forEach(d => { domainWeights[d.domain_code] = Number(d.default_weight); });

        // The wizard may have moved the dials. Anything it did not send falls
        // back to the platform default, so a client created from the short form
        // and one created from the wizard are the same shape afterwards.
        const dims = weights && Object.keys(weights).length
            ? weights : scoring.DEFAULT_DIMENSION_WEIGHTS;

        // The database enforces tier1 > tier2 with a CHECK constraint. Catching
        // it here means a readable message instead of a 500 from a rolled back
        // transaction the caller cannot interpret.
        const t1 = Number(tier1 ?? scoring.DEFAULT_TIER1);
        const t2 = Number(tier2 ?? scoring.DEFAULT_TIER2);
        if (!(t1 > t2)) {
            await conn.rollback();
            return res.status(400).json({
                error: "BAD_THRESHOLDS",
                message: "Tier 1 must sit above Tier 2. A supplier cannot be critical at a lower score than it is significant.",
            });
        }

        const total = Object.values(dims).reduce((a, b) => a + Number(b), 0);
        if (Math.abs(total - 1) > 0.001) {
            await conn.rollback();
            return res.status(400).json({
                error: "WEIGHTS_UNBALANCED",
                message: `Tiering weights must total exactly 1.00. They currently total ${total.toFixed(2)}.`,
            });
        }

        await conn.query(
            `INSERT INTO tenant_methodology
               (tenant_id, dimension_weights, domain_weights, tier1_threshold, tier2_threshold, sla_json, edited_by)
             VALUES (?,?,?,?,?,?,?)`,
            [tenantId, JSON.stringify(dims), JSON.stringify(domainWeights),
             t1, t2, JSON.stringify(sla && Object.keys(sla).length ? sla : scoring.DEFAULT_SLA),
             req.emp_id]
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

        // The team named in the wizard, granted in the same transaction. A
        // client that exists with nobody on it is a client somebody has to
        // remember to come back to.
        const granted = [];
        if (Array.isArray(team) && team.length) {
            const [roles] = await conn.query(`SELECT role_id, role_code, rank_value FROM tprm_role`);
            const byCode = Object.fromEntries(roles.map(r => [r.role_code, r]));
            // Nobody may grant a role above their own rank, and the check lives
            // here rather than only in the dropdown that offered it.
            const myRank = req.setupMode ? Infinity
                : Math.max(0, ...Object.values(req.grants || {}).map(g => g.rank || 0));

            for (const t of team) {
                const role = byCode[t.roleCode];
                if (!role || !t.empId) continue;
                if (Number(role.rank_value) > myRank) {
                    await conn.rollback();
                    return res.status(403).json({
                        error: "RANK_EXCEEDED",
                        message: `You cannot grant ${role.role_code}: it outranks your own role on this client.`,
                    });
                }
                if (String(t.empId) === String(req.emp_id)) continue;
                await conn.query(
                    `INSERT IGNORE INTO tprm_user_tenant_role (emp_id, tenant_id, role_id, granted_by)
                     VALUES (?,?,?,?)`,
                    [t.empId, tenantId, role.role_id, req.emp_id]);
                granted.push({ empId: t.empId, roleCode: role.role_code });
            }
        }

        await conn.commit();
        await audit(req, {
            action: 'client.created', entity: 'tenant', entityId: tenantId,
            after: { code, name: tenantName, tradingName: tradingName || null,
                     contactName: contactName || null, contactEmail: contact || null,
                     context: context || null },
            tenantId,
        });
        for (const g of granted) {
            await audit(req, {
                action: 'role.granted', entity: 'tprm_user_tenant_role', entityId: g.empId,
                after: { role: g.roleCode }, tenantId,
            });
        }
        res.status(201).json({
            success: true, tenant_id: tenantId, tenant_code: code, granted: granted.length,
        });
    } catch (e) {
        await conn.rollback().catch(() => {});
        logError("clients/create", e, req);
        res.status(500).json({ error: "Database error" });
    } finally {
        conn.release();
    }
});

/* ------------------------------------------------------- the role landing */

/* The numbers the landing page opens on. Every one of them is scoped to the
   clients the caller holds a role on, so a Practice Head with four engagements
   and an Assessor with two see the same page reporting different practices.
   Which four are shown is the caller's role, decided on the client - the
   figures a reviewer opens the morning on are not the ones a Practice Head
   does, so the page cannot be one fixed set of counts. */
router.get("/landing", async (req, res) => {
    try {
        const ids = memberTenantIds(req);
        if (!ids.length) return res.json({ tenants: 0, stats: null });
        const inTenants = `(${ids.map(() => '?').join(',')})`;

        const one = async (sql, params) => {
            const [[r]] = await db.query(sql, params);
            return Number(r.n) || 0;
        };

        const [counts] = await Promise.all([Promise.all([
            // clients, third parties, open findings - the three every role needs
            Promise.resolve(ids.length),
            one(`SELECT COUNT(*) AS n FROM third_party
                  WHERE tenant_id IN ${inTenants} AND deleted_time IS NULL`, ids),
            one(`SELECT COUNT(*) AS n FROM finding
                  WHERE tenant_id IN ${inTenants} AND status IN ('open','in_progress')`, ids),
            // people holding a grant anywhere in the practice
            one(`SELECT COUNT(DISTINCT emp_id) AS n FROM tprm_user_tenant_role
                  WHERE tenant_id IN ${inTenants} AND revoked_time IS NULL`, ids),
            // approved but not yet issued - an Engagement Manager's queue
            one(`SELECT COUNT(*) AS n FROM assessment
                  WHERE tenant_id IN ${inTenants} AND state = 'approved'`, ids),
            // a Lead Assessor's queue
            one(`SELECT COUNT(*) AS n FROM assessment
                  WHERE tenant_id IN ${inTenants} AND state = 'under_review'`, ids),
            // submitted once and back with the assessor: that is a send back
            one(`SELECT COUNT(*) AS n FROM assessment
                  WHERE tenant_id IN ${inTenants} AND state = 'in_progress'
                    AND submitted_time IS NOT NULL`, ids),
            one(`SELECT COUNT(*) AS n FROM assessment
                  WHERE tenant_id IN ${inTenants} AND approved_time >= ?`,
                [...ids, new Date(new Date().getFullYear(), new Date().getMonth(), 1)]),
            one(`SELECT COUNT(*) AS n FROM assessment
                  WHERE tenant_id IN ${inTenants} AND state = 'on_hold'`, ids),
            // an Assessor's own work
            one(`SELECT COUNT(*) AS n FROM assessment
                  WHERE tenant_id IN ${inTenants} AND assessor_id = ?
                    AND state IN ('draft','in_progress','on_hold')`, [...ids, req.emp_id]),
            one(`SELECT COUNT(*) AS n FROM finding f
                   JOIN assessment a ON a.assessment_id = f.assessment_id
                  WHERE f.tenant_id IN ${inTenants} AND a.assessor_id = ?
                    AND f.status IN ('open','in_progress')
                    AND f.due_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`, [...ids, req.emp_id]),
            one(`SELECT COUNT(DISTINCT a.assessment_id) AS n FROM assessment a
                   JOIN response r ON r.assessment_id = a.assessment_id AND r.vendor_asserted = 1
                  WHERE a.tenant_id IN ${inTenants} AND a.assessor_id = ?`, [...ids, req.emp_id]),
            one(`SELECT COUNT(*) AS n FROM finding f
                   JOIN assessment a ON a.assessment_id = f.assessment_id
                  WHERE f.tenant_id IN ${inTenants} AND a.assessor_id = ?
                    AND f.status IN ('open','in_progress')`, [...ids, req.emp_id]),
            // the library, which belongs to nobody in particular
            one(`SELECT COUNT(DISTINCT sector_code) AS n FROM instrument_version
                  WHERE status = 'published'`, []),
            one(`SELECT COUNT(*) AS n FROM question q
                   JOIN instrument_version iv
                     ON iv.instrument_version_id = q.instrument_version_id
                  WHERE iv.status = 'published'`, []),
            one(`SELECT COUNT(*) AS n FROM standard WHERE active = 1`, []),
            one(`SELECT COUNT(*) AS n FROM instrument_version WHERE status = 'draft'`, []),
            // a Client Viewer's own position
            one(`SELECT COUNT(*) AS n FROM assessment
                  WHERE tenant_id IN ${inTenants} AND tier = 1`, ids),
            one(`SELECT COUNT(*) AS n FROM assessment
                  WHERE tenant_id IN ${inTenants} AND tier = 1 AND state IN ('approved','issued','closed')`, ids),
            one(`SELECT COUNT(*) AS n FROM finding
                  WHERE tenant_id IN ${inTenants} AND severity = 'Critical'
                    AND status IN ('open','in_progress')`, ids),
            one(`SELECT COUNT(*) AS n FROM report_issue WHERE tenant_id IN ${inTenants}`, ids),
        ])]);

        const [clients, thirdParties, openFindings, users, awaitingIssue, awaitingReview,
            sentBack, approvedThisMonth, onHold, assignedToMe, dueThisWeek, awaitingVendor,
            myOpenFindings, instruments, questions, standards, drafts,
            tier1Total, tier1Done, openCritical, reportsIssued] = counts;

        res.json({
            tenants: ids.length,
            stats: {
                clients, thirdParties, openFindings, users, awaitingIssue, awaitingReview,
                sentBack, approvedThisMonth, onHold, assignedToMe, dueThisWeek, awaitingVendor,
                myOpenFindings, instruments, questions, standards, drafts,
                openCritical, reportsIssued,
                tier1Coverage: tier1Total ? Math.round((tier1Done / tier1Total) * 100) : 0,
            },
        });
    } catch (e) {
        logError("clients/landing", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* ------------------------------------------------- the client header bar */

/* Everything the client bar needs to name the engagement it is scoped to:
   the code that appears in every document reference, the legal and trading
   names, the client's own sector, and the operating context captured at
   onboarding. The regulatory overlay was resolved once, when the client was
   created, and stored with it - so the bar shows what the assessments are
   actually inheriting rather than re-deriving it from a table the front end
   would then have to keep in step. */
router.get("/:tenantId/context", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'dashboard.view')) return;

        const [[t]] = await db.query(
            `SELECT t.tenant_id, t.tenant_code, t.tenant_name, t.trading_name,
                    t.contact_name, t.contact_email,
                    t.default_sector, t.context_json, t.status, s.sector_name
               FROM tenant t
               LEFT JOIN sector s ON s.sector_code = t.default_sector
              WHERE t.tenant_id = ? AND t.deleted_time IS NULL`,
            [req.tenantId]);
        if (!t) return res.status(404).json({ error: "That client does not exist" });

        // A JSON column comes back parsed on some driver versions and as text
        // on others. Normalise here so the page never has to care.
        let ctx = t.context_json;
        if (typeof ctx === 'string') { try { ctx = JSON.parse(ctx); } catch { ctx = null; } }
        ctx = ctx || {};

        res.json({
            tenantId: t.tenant_id,
            code: t.tenant_code,
            name: t.tenant_name,
            tradingName: t.trading_name,
            contactName: t.contact_name,
            contactEmail: t.contact_email,
            sectorCode: t.default_sector,
            sectorName: t.sector_name || t.default_sector || null,
            status: t.status,
            // The first operating region is the one the bar shows. The rest
            // stay available for anything that needs the full list.
            regions: Array.isArray(ctx.regions) ? ctx.regions : [],
            scaleBand: ctx.scaleBand || null,
            overlay: Array.isArray(ctx.overlay) ? ctx.overlay : [],
            regulators: Array.isArray(ctx.regulators) ? ctx.regulators : [],
            dataTypes: Array.isArray(ctx.dataTypes) ? ctx.dataTypes : [],
            secondarySectors: Array.isArray(ctx.secondarySectors) ? ctx.secondarySectors : [],
        });
    } catch (e) {
        logError("clients/context", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* The onboarding checklist on a client's own overview.
 *
 * Every step is derived from whether the thing actually exists, never from a
 * stored "step 3 done" flag. A flag would go stale the moment somebody deleted
 * the last third party, and the checklist would then confidently tell them a
 * job was finished that was not. */
router.get("/:tenantId/overview", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'dashboard.view')) return;
        const tid = req.tenantId;

        const one = async (sql, params) => {
            const [[r]] = await db.query(sql, params || [tid]);
            return r;
        };

        const meth = await one(
            `SELECT dimension_weights, tier1_threshold, tier2_threshold
               FROM tenant_methodology WHERE tenant_id = ?`);

        const team = await one(
            `SELECT COUNT(*) AS n,
                    SUM(r.is_client_role = 1) AS viewers
               FROM tprm_user_tenant_role utr
               JOIN tprm_role r ON r.role_id = utr.role_id
              WHERE utr.tenant_id = ? AND utr.revoked_time IS NULL`);

        const tps = await one(
            `SELECT COUNT(*) AS n FROM third_party
              WHERE tenant_id = ? AND deleted_time IS NULL`);

        const assigned = await one(
            `SELECT COUNT(*) AS n FROM assessment
              WHERE tenant_id = ? AND assessor_id IS NOT NULL`);

        const issued = await one(
            `SELECT COUNT(*) AS n FROM report_issue WHERE tenant_id = ?`);

        // The methodology row is written with the client, so it always exists.
        // What tells you it was actually SET is whether the dials still add up.
        let weights = meth && meth.dimension_weights;
        if (typeof weights === 'string') { try { weights = JSON.parse(weights); } catch { weights = null; } }
        const total = weights
            ? Object.values(weights).reduce((a, b) => a + Number(b), 0)
            : 0;
        const balanced = Math.abs(total - 1) < 0.001;

        const internal = Number(team.n || 0) - Number(team.viewers || 0);

        res.json({
            methodology: meth ? {
                tier1: Number(meth.tier1_threshold),
                tier2: Number(meth.tier2_threshold),
                balanced,
            } : null,
            team: { total: Number(team.n || 0), internal, viewers: Number(team.viewers || 0) },
            thirdParties: Number(tps.n || 0),
            assessmentsAssigned: Number(assigned.n || 0),
            reportsIssued: Number(issued.n || 0),
        });
    } catch (e) {
        logError("clients/overview", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/* -------------------------------------------------- per-client dashboard */
router.get("/:tenantId/dashboard", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'dashboard.view')) return;
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
        if (!permitted(req, res, 'methodology.edit')) return;

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

/* The whole matrix, read from the two tables that decide it.
 *
 * Read rather than listed in the client, because a picture of the rules drawn
 * by hand stops being true the moment the rules move, and a permission diagram
 * that is quietly out of date is worse than none - people plan access around
 * it. This is the same tprm_role_permission that requirePerm consults on every
 * request, so what the modal shows is what the API will actually do.
 *
 * No permission gate: it describes capabilities in the abstract and names
 * nobody. Who holds which role is the members list, which is gated. */
router.get("/permission-matrix", async (_req, res) => {
    try {
        const [roles] = await db.query(
            `SELECT role_code, role_name, rank_value, can_grant, description
               FROM tprm_role ORDER BY rank_value DESC, role_code`);
        const [perms] = await db.query(
            `SELECT p.perm_key, p.label, p.category,
                    GROUP_CONCAT(r.role_code ORDER BY r.rank_value DESC) AS role_codes
               FROM tprm_permission p
               LEFT JOIN tprm_role_permission rp
                      ON rp.permission_id = p.permission_id AND rp.granted = 1
               LEFT JOIN tprm_role r ON r.role_id = rp.role_id
              GROUP BY p.permission_id, p.perm_key, p.label, p.category, p.sort_order
              ORDER BY p.sort_order, p.perm_key`);
        res.json({
            roles,
            permissions: perms.map(p => ({
                perm_key: p.perm_key,
                label: p.label,
                category: p.category,
                roles: p.role_codes ? String(p.role_codes).split(',') : [],
            })),
        });
    } catch (e) {
        logError("permission matrix", e, _req);
        res.status(500).json({ error: "Database error" });
    }
});

/* Change one cell of the permission matrix.
 *
 * The screen has always claimed the matrix is editable and that permissions
 * are data rather than code. They were data, but nothing wrote them, so the
 * claim was false and a change meant a migration and a deploy.
 *
 * Two guards, and the second is the one that matters:
 *
 *   Practice Head cannot be edited at all. It is the backstop role - the only
 *   one holding permission.edit - so allowing it to be stripped would let one
 *   careless click leave a system nobody can administer, with no route back
 *   that does not involve SQL on the box.
 *
 *   A permission is only ever granted or revoked for a role, never for a
 *   person. Personal exceptions are how a matrix stops describing reality.
 *
 * Not scoped to a client: tprm_role_permission is global, so this is what a
 * role means everywhere. requirePerm without a tenant on the request accepts
 * the permission held anywhere, which is right - a Practice Head on any
 * engagement owns the practice's role definitions.
 */
router.put("/permission-matrix", requirePerm('permission.edit'), async (req, res) => {
    try {
        const { roleCode, permKey, granted } = req.body || {};
        if (!roleCode || !permKey || typeof granted !== 'boolean') {
            return res.status(400).json({
                error: "BAD_REQUEST",
                message: "roleCode, permKey and granted are all required",
            });
        }
        if (String(roleCode).toUpperCase() === 'PH') {
            return res.status(403).json({
                error: "PRACTICE_HEAD_LOCKED",
                message: "Practice Head holds every capability by definition. It is the role that "
                    + "edits this matrix, so it cannot be edited here - removing something from it "
                    + "could leave the system with nobody able to put it back.",
            });
        }

        const [[role]] = await db.query(
            `SELECT role_id, role_code, role_name FROM tprm_role WHERE role_code = ?`, [roleCode]);
        if (!role) return res.status(404).json({ error: "ROLE_UNKNOWN", message: "That role does not exist" });

        const [[perm]] = await db.query(
            `SELECT permission_id, perm_key, label FROM tprm_permission WHERE perm_key = ?`, [permKey]);
        if (!perm) return res.status(404).json({ error: "PERM_UNKNOWN", message: "That capability does not exist" });

        const [[before]] = await db.query(
            `SELECT granted FROM tprm_role_permission WHERE role_id = ? AND permission_id = ?`,
            [role.role_id, perm.permission_id]);
        const had = !!(before && Number(before.granted) === 1);
        if (had === granted) return res.json({ success: true, unchanged: true });

        /* Granted rows are written; revoked rows are deleted rather than set
           to granted = 0. The absence of a row is what every other role's
           absence looks like, and two ways of saying "no" in one table is how
           a matrix starts disagreeing with itself - the same reasoning as
           migration 018. */
        if (granted) {
            await db.query(
                `INSERT INTO tprm_role_permission (role_id, permission_id, granted, edited_by)
                 VALUES (?,?,1,?)
                 ON DUPLICATE KEY UPDATE granted = 1, edited_by = VALUES(edited_by)`,
                [role.role_id, perm.permission_id, req.emp_id]);
        } else {
            await db.query(
                `DELETE FROM tprm_role_permission WHERE role_id = ? AND permission_id = ?`,
                [role.role_id, perm.permission_id]);
        }

        /* tprm_role.can_grant is the same fact said a second way - it is what
           the role list prints in its "Can grant" column. Kept in step, or the
           screen claims a role grants access on the page where it no longer
           can. Again the reasoning from 018. */
        if (perm.perm_key === 'user.grant') {
            await db.query(`UPDATE tprm_role SET can_grant = ? WHERE role_id = ?`,
                [granted ? 1 : 0, role.role_id]);
        }

        await audit(req, {
            action: granted ? 'permission.granted' : 'permission.revoked',
            entity: 'tprm_role_permission', entityId: role.role_code,
            before: { role: role.role_code, permission: perm.perm_key, granted: had },
            after: { role: role.role_code, permission: perm.perm_key, granted },
        });

        res.json({
            success: true,
            message: `${perm.label} ${granted ? 'granted to' : 'removed from'} ${role.role_name}`,
        });
    } catch (e) {
        logError("permission matrix edit", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.get("/:tenantId/members", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;
        if (!permitted(req, res, 'user.grant')) return;

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
/* Everyone who could be put on a client that does not exist yet. The onboarding
   wizard names its team before there is a tenant to scope the question to, so
   this is the same list as grantable-employees with nothing to exclude. */
router.get("/employees", requirePerm('client.create'), async (req, res) => {
    try {
        const [emps] = await dadmin.query(
            `SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name, emp_mail_id
               FROM employee
              WHERE deleted_time IS NULL AND active = 1
              ORDER BY emp_first_name, emp_last_name`);
        res.json(emps);
    } catch (e) {
        logError("clients/employees", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

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
