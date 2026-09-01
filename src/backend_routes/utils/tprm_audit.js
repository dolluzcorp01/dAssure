// Append-only audit trail + the permission gate that every write route uses.
//
// Permission is always resolved from the database on the request, never
// trusted from the JWT payload, so revoking a role takes effect immediately
// rather than when the token expires.

const getDBConnection = require('../../../config/db');
const { logError } = require('./tprm_log');
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();
const dadmin = getDBConnection('dadmin').promise();

// First-run setup.
//
// dTprm access is the engagement grant, so on a brand new system nobody can
// sign in: the person who hands out grants would need a grant themselves.
// Setup mode is the one narrow door out of that. It is open only while the
// system has never been set up - not one live grant anywhere - and only to
// someone who is already an administrator in dAdmin. It grants exactly two
// abilities, and it closes by itself the moment the first grant exists,
// because at that point the condition below stops being true.
const SETUP_PERMS = new Set(['client.create', 'user.grant']);

/** True when no live engagement grant exists anywhere in the system. */
async function systemHasNoGrants() {
    const [rows] = await db.query(
        'SELECT 1 AS x FROM tprm_user_tenant_role WHERE revoked_time IS NULL LIMIT 1');
    return rows.length === 0;
}

/** dAdmin's own administrator flag. Only consulted for first-run setup. */
async function isDadminAdmin(empId) {
    if (!empId) return false;
    const [rows] = await dadmin.query(
        'SELECT emp_access_level FROM employee WHERE emp_id = ? AND deleted_time IS NULL AND active = 1',
        [empId]);
    return rows.length > 0 && String(rows[0].emp_access_level || '').toLowerCase() === 'admin';
}

/** Both conditions together. Cheap to call - the first query is indexed. */
async function inSetupMode(empId) {
    if (!(await systemHasNoGrants())) return false;
    return isDadminAdmin(empId);
}

/** Writes one row to tprm_audit_event. Never throws - a failed audit write
 *  must not take down the action being audited, but it is logged loudly.
 *
 *  entity_id is polymorphic and holds two shapes: numeric ids from this
 *  database (assessment_id, tenant_id) and employee ids from dadmin, which
 *  are strings like 'DZIND148'. The column is VARCHAR, so both are written as
 *  text and neither is coerced. See db/migrations/008_audit_entity_id.sql. */
async function audit(req, { action, entity, entityId, before, after, reason, tenantId }) {
    try {
        const id = entityId === null || entityId === undefined || entityId === ''
            ? null
            : String(entityId);
        await db.query(
            `INSERT INTO tprm_audit_event
               (actor_emp_id, actor_email, tenant_id, action, entity_type, entity_id,
                before_json, after_json, reason, ip_addr, user_agent)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [
                req.emp_id || null,
                (req.tprmUser && req.tprmUser.emp_mail_id) || null,
                tenantId || req.tenantId || null,
                action, entity, id,
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
            roles: [], roleNames: [], perms: new Set(), rank: 0, canGrant: false,
        });
        // Codes drive logic, names are what a person reads. Both are carried so
        // the interface never has to show 'PH' where it means 'Practice Head'.
        if (!t.roles.includes(r.role_code)) {
            t.roles.push(r.role_code);
            t.roleNames.push(r.role_name);
        }
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
        // Only worth asking when the caller holds nothing. Anyone with a grant
        // is past setup by definition.
        req.setupMode = Object.keys(req.grants).length === 0
            ? await inSetupMode(req.emp_id)
            : false;

        // verifyJWT accepts the shared dolluzcorp_token, so anyone signed into
        // dAdmin or Inside D reaches this point without ever passing the
        // NO_ENGAGEMENT check in /Verifylogin. Without this, they could read
        // the whole question bank and methodology through the library routes,
        // which carry no permission of their own. Every route file already
        // runs tenantScope, so refusing here closes the class in one place.
        //
        // First run is the one exception: the person setting the system up has
        // no grant by definition. That mode only opens when the entire system
        // holds zero grants AND the caller is a dAdmin administrator, and it
        // permits only client.create and user.grant.
        if (!Object.keys(req.grants).length && !req.setupMode) {
            return res.status(403).json({
                error: 'NO_ENGAGEMENT',
                message: 'You have not been assigned to a client engagement in dTprm yet.',
            });
        }
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
        // First run: the two abilities needed to open the system up.
        if (req.setupMode && SETUP_PERMS.has(permKey)) return next();
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

module.exports = {
    audit, grantsFor, tenantScope, requireTenant, requirePerm, memberTenantIds,
    inSetupMode, systemHasNoGrants, SETUP_PERMS,
};
