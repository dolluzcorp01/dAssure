// Findings and their SLA clocks.
//
// due_at is set when the finding is raised, from the client's own SLA table.
// sla_paused_sec accumulates while the case is on hold, so days_remaining is
// the honest figure rather than one that punishes us for a client's delay.

require("dotenv").config({ quiet: true });
const express = require("express");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requireTenant, requirePerm } = require('./utils/tprm_audit');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();

router.use(verifyJWT, tenantScope);

router.get("/:tenantId/list", async (req, res) => {
    try {
        req.tenantId = Number(req.params.tenantId);
        if (!requireTenant(req, res)) return;

        const status = req.query.status;
        const severity = req.query.severity;
        const params = [req.tenantId];
        let where = `f.tenant_id = ?`;
        if (status && status !== 'all') { where += ` AND f.status = ?`; params.push(status); }
        else if (!status) { where += ` AND f.status IN ('open','in_progress','evidence_under_review')`; }
        if (severity && severity !== 'all') { where += ` AND f.severity = ?`; params.push(severity); }

        const [rows] = await db.query(
            `SELECT f.*, tp.third_party_name, tp.ref_code, cd.domain_name,
                    DATEDIFF(f.due_at, CURDATE()) + FLOOR(f.sla_paused_sec / 86400) AS days_remaining,
                    CASE WHEN f.status IN ('open','in_progress')
                          AND DATEDIFF(f.due_at, CURDATE()) + FLOOR(f.sla_paused_sec / 86400) < 0
                         THEN 1 ELSE 0 END AS breached
               FROM finding f
               JOIN assessment a ON a.assessment_id = f.assessment_id
               JOIN third_party tp ON tp.third_party_id = a.third_party_id
               LEFT JOIN control_domain cd ON cd.domain_code = f.domain_code
              WHERE ${where}
              ORDER BY breached DESC,
                       FIELD(f.severity,'Critical','High','Medium','Low'),
                       f.due_at`,
            params);
        res.json(rows);
    } catch (e) {
        logError("findings list", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.put("/:id", requirePerm('finding.manage'), async (req, res) => {
    try {
        const [[f]] = await db.query(`SELECT * FROM finding WHERE finding_id=?`, [req.params.id]);
        if (!f) return res.status(404).json({ error: "That finding does not exist" });
        req.tenantId = Number(f.tenant_id);
        if (!requireTenant(req, res)) return;

        const { status, vendorOwner, detail, dueAt } = req.body;
        const allowed = ['open', 'in_progress', 'evidence_under_review', 'closed'];
        if (status && !allowed.includes(status)) {
            return res.status(400).json({
                error: "BAD_STATUS",
                message: "Accepting a risk is a separate action - use the Accept risk button, it needs a reason and an expiry.",
            });
        }

        const closing = status === 'closed' && f.status !== 'closed';
        await db.query(
            `UPDATE finding SET
               status       = COALESCE(?, status),
               vendor_owner = COALESCE(?, vendor_owner),
               detail       = COALESCE(?, detail),
               due_at       = COALESCE(?, due_at),
               closed_at    = ${closing ? 'CURDATE()' : 'closed_at'},
               closed_by    = ${closing ? '?' : 'closed_by'}
             WHERE finding_id = ?`,
            closing
                ? [status || null, vendorOwner || null, detail || null, dueAt || null, req.emp_id, f.finding_id]
                : [status || null, vendorOwner || null, detail || null, dueAt || null, f.finding_id]);

        await audit(req, {
            action: 'finding.updated', entity: 'finding', entityId: f.finding_id,
            before: { status: f.status, due_at: f.due_at },
            after: { status, dueAt }, tenantId: f.tenant_id,
        });
        res.json({ success: true });
    } catch (e) {
        logError("finding update", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

/** Accepting a risk is deliberately its own endpoint behind its own
 *  permission. It needs a named owner, a written reason, and an expiry date,
 *  because an accepted risk with no expiry is just a risk nobody looks at. */
router.post("/:id/accept", requirePerm('risk.accept'), async (req, res) => {
    try {
        const [[f]] = await db.query(`SELECT * FROM finding WHERE finding_id=?`, [req.params.id]);
        if (!f) return res.status(404).json({ error: "That finding does not exist" });
        req.tenantId = Number(f.tenant_id);
        if (!requireTenant(req, res)) return;

        const { reason, owner, expires } = req.body;
        if (!reason || String(reason).trim().length < 20) {
            return res.status(400).json({
                error: "REASON_REQUIRED",
                message: "Accepting a risk needs at least 20 characters of written rationale",
            });
        }
        if (!owner) return res.status(400).json({ error: "OWNER_REQUIRED", message: "Name the person accepting this risk" });
        if (!expires) {
            return res.status(400).json({
                error: "EXPIRY_REQUIRED",
                message: "An accepted risk needs a review date. Acceptance is temporary, not permanent.",
            });
        }

        await db.query(
            `UPDATE finding SET status='accepted', accept_reason=?, accept_owner=?, accept_expires=?
              WHERE finding_id=?`,
            [String(reason).trim(), owner, expires, f.finding_id]);
        await audit(req, {
            action: 'finding.risk_accepted', entity: 'finding', entityId: f.finding_id,
            after: { owner, expires }, reason, tenantId: f.tenant_id,
        });
        res.json({ success: true });
    } catch (e) {
        logError("accept risk", e, req);
        res.status(500).json({ error: "Database error" });
    }
});

module.exports = router;
