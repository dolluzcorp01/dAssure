// Append-only audit trail + the permission gate that every write route uses.
//
// Permission is always resolved from the database on the request, never
// trusted from the JWT payload, so revoking a role takes effect immediately
// rather than when the token expires.

const getDBConnection = require('../../../config/db');
const { logError } = require('./tprm_log');
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();

/** Writes one row to tprm_audit_event. Never throws - a failed audit write
 *  must not take down the action being audited, but it is logged loudly. */
async function audit(req, { action, entity, entityId, before, after, reason, tenantId }) {
    try {
        await db.query(
            `INSERT INTO tprm_audit_event
               (actor_emp_id, actor_email, tenant_id, action, entity_type, entity_id,
                before_json, after_json, reason, ip_addr, user_agent)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [
                req.emp_id || null,
                (req.tprmUser && req.tprmUser.emp_mail_id) || null,
                tenantId || req.tenantId || null,
                action, entity, entityId || null,
                before ? JSON.stringify(before) : null,
                after ? JSON.stringify(after) : null,
                reason || null,
                (req.ip || '').replace('::ffff:', '').slice(0, 45),
                (req.headers['user-agent'] || '').slice(0, 300),
            ]
        );
    } catch (e) {
        logError('audit write', e, req);
    }
}

/**
 * Loads every live grant for an employee, keyed by tenant. A person can be
 * Lead Assessor on one client and plain Assessor on another, so permission
 * is never a global property - it is always scoped to a client.
 */
async function grantsFor(empId) {
    const [rows] = await db.query(
        `SELECT utr.tenant_id, r.role_code, r.role_name, r.rank_value, r.can_grant, p.perm_key
           FROM tprm_user_tenant_role utr
           JOIN tprm_role r ON r.role_id = utr.role_id
           LEFT JOIN tprm_role_permission rp ON rp.role_id = r.role_id AND rp.granted = 1
           LEFT JOIN tprm_permission p ON p.permission_id = rp.permission_id
          WHERE utr.emp_id = ? AND utr.revoked_time IS NULL`,
        [empId]
    );
    const byTenant = {};
    for (const r of rows) {
        const t = byTenant[r.tenant_id] || (byTenant[r.tenant_id] = {
            roles: [], perms: new Set(), rank: 0, canGrant: false,
        });
        if (!t.roles.includes(r.role_code)) t.roles.push(r.role_code);
        if (r.perm_key) t.perms.add(r.perm_key);
        t.rank = Math.max(t.rank, Number(r.rank_value));
        t.canGrant = t.canGrant || !!r.can_grant;
    }
    return byTenant;
}

/**
 * Express middleware. Reads the client from the x-tenant-id header (or
 * :tenantId route param), attaches req.tenantId and req.grants.
 * Place after verifyJWT on every route below /api/tprm.
 */
async function tenantScope(req, res, next) {
    try {
        if (!req.emp_id) return res.status(401).json({ error: 'Unauthorized access' });

        // Router-level middleware runs before route params are bound, so
        // req.params.tenantId is not populated yet. Read the id straight out
        // of the path instead. This matters: requirePerm runs before the
        // handler, and without this it would check the permission against
        // whatever client the browser happened to have selected rather than
        // the one named in the URL.
        const fromPath = /^\/(\d+)(\/|$)/.exec(req.path);
        const raw = (fromPath && fromPath[1])
            || req.params.tenantId
            || req.headers['x-tenant-id']
            || req.query.tenantId;

        req.tenantId = raw ? Number(raw) : null;
        req.grants = await grantsFor(req.emp_id);
        next();
    } catch (e) {
        logError('tenantScope', e, req);
        res.status(500).json({ error: 'Database error' });
    }
}

/** Membership check. Nobody reads another client's data by guessing an id. */
function requireTenant(req, res) {
    if (!req.tenantId) {
        res.status(400).json({ error: 'TENANT_REQUIRED', message: 'This action needs a client context' });
        return false;
    }
    if (!req.grants || !req.grants[req.tenantId]) {
        res.status(403).json({ error: 'NOT_A_MEMBER', message: 'You do not have access to this client' });
        return false;
    }
    return true;
}

/**
 * Permission gate.
 *   router.post('/x', verifyJWT, tenantScope, requirePerm('vendor.manage'), handler)
 *
 * If a client is on the request, the permission must be held ON THAT CLIENT.
 * With no client on the request, holding it anywhere is enough (used by list
 * endpoints that filter by membership themselves).
 */
function requirePerm(permKey) {
    return (req, res, next) => {
        const grants = req.grants || {};
        if (req.tenantId) {
            const t = grants[req.tenantId];
            if (t && t.perms.has(permKey)) return next();
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: `Your role on this client does not allow: ${permKey}`,
            });
        }
        for (const t of Object.values(grants)) {
            if (t.perms.has(permKey)) return next();
        }
        return res.status(403).json({
            error: 'FORBIDDEN',
            message: `Your role does not allow: ${permKey}`,
        });
    };
}

/** Convenience: every tenant id the caller is a member of. */
const memberTenantIds = (req) => Object.keys(req.grants || {}).map(Number);

module.exports = { audit, grantsFor, tenantScope, requireTenant, requirePerm, memberTenantIds };
