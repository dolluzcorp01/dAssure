import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPost, apiPut, apiDelete } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_UsersAndRoles.css";
import TPRMSelect from "./TPRM_Select";
import { ROLE_INFO } from "./utils/tprmRoles";

function TPRMUsersAndRoles() {
    const { tenantId, tenant, user, hasPerm } = useAccess();
    const [members, setMembers] = useState(null);
    const [roles, setRoles] = useState([]);
    const [grantable, setGrantable] = useState([]);
    const [form, setForm] = useState(null);
    const [busy, setBusy] = useState(false);
    // The full capability grid, read from the same tables the API checks.
    const [matrix, setMatrix] = useState(null);
    const [showMatrix, setShowMatrix] = useState(false);
    // Which cell is mid-flight, so two clicks cannot race each other.
    const [cellBusy, setCellBusy] = useState(null);

    const load = useCallback(() => {
        if (!tenantId) return;
        apiJson(`/api/tprm/clients/${tenantId}/members`).then(setMembers).catch(() => setMembers([]));
        apiJson(`/api/tprm/clients/${tenantId}/grantable-employees`).then(setGrantable).catch(() => {});
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { apiJson("/api/tprm/clients/roles").then(setRoles).catch(() => {}); }, []);

    /* Editing the matrix changes what a role means everywhere, for everyone,
       on every client - so it is Practice Head only, and the server checks
       permission.edit again whatever this decides to render. */
    const canEditMatrix = hasPerm("permission.edit");

    const toggleCell = async (roleCode, permKey, has) => {
        if (!canEditMatrix || roleCode === "PH") return;
        const cell = roleCode + ":" + permKey;
        setCellBusy(cell);
        try {
            const r = await apiPut("/api/tprm/clients/permission-matrix",
                { roleCode, permKey, granted: !has });
            // Patched in place rather than refetching the whole grid, so the
            // tick moves under the pointer that asked for it.
            setMatrix(m => ({
                ...m,
                permissions: m.permissions.map(p => p.perm_key !== permKey ? p : {
                    ...p,
                    roles: has ? p.roles.filter(c => c !== roleCode)
                        : [...p.roles, roleCode],
                }),
            }));
            if (r && r.message) tprmAlert.success("Saved", r.message);
        } catch (e) {
            tprmAlert.apiError(e);
        } finally {
            setCellBusy(null);
        }
    };

    // Fetched once, when it is first asked for. Nobody opens this page to read
    // the matrix, so it does not need to be on the wire before they do.
    const openMatrix = () => {
        setShowMatrix(true);
        if (!matrix) {
            apiJson("/api/tprm/clients/permission-matrix")
                .then(setMatrix)
                .catch(e => { tprmAlert.apiError(e); setShowMatrix(false); });
        }
    };

    const grant = async () => {
        setBusy(true);
        try {
            const r = await apiPost(`/api/tprm/clients/${tenantId}/members`,
                { empId: form.empId, roleId: form.roleId });
            tprmAlert.success(r.message);
            setForm(null); load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const revoke = async (m) => {
        const ok = await tprmAlert.confirm(
            `Revoke ${m.emp_name}'s access?`,
            "They lose access to this client immediately. Work they have already done stays on the record.",
            "Yes, revoke");
        if (!ok) return;
        try {
            await apiDelete(`/api/tprm/clients/${tenantId}/members/${m.emp_id}`);
            load();
        } catch (e) { tprmAlert.apiError(e); }
    };

    if (!tenantId) {
        return <div className="tprm-page"><div className="tprm-note warn">Select a client first.</div></div>;
    }
    if (!members) return <div className="tprm-loading">Loading...</div>;

    // The delegation ceiling, mirrored in the UI. The server enforces it too.
    const myRank = tenant && tenant.rank ? Number(tenant.rank) : 0;
    const grantableRoles = roles.filter(r => Number(r.rank_value) <= myRank);

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <div className="tprm-page-sub">
                        Roles are per client. Someone can be a Lead Assessor on one engagement and an
                        Assessor on another. You can only grant a role at or below your own level.
                    </div>
                </div>
                <div className="tprm-page-actions">
                    <button
                        className="tprm-btn primary"
                        onClick={() => setForm({ empId: "", roleId: "" })}
                        disabled={grantableRoles.length === 0}
                    >
                        Grant access
                    </button>
                </div>
            </div>

            <div className="tprm-card flush" style={{ marginBottom: 18 }}>
                <div className="tprm-card-head">
                    <div className="tprm-card-title">
                        WHO CAN WORK ON {tenant ? tenant.tenant_name.toUpperCase() : "THIS CLIENT"}
                    </div>
                </div>
                <table className="tprm-table">
                    <thead>
                        <tr><th>Name</th><th>Email</th><th>Role</th><th>Level</th>
                            <th>Last sign-in</th><th>Granted</th><th></th></tr>
                    </thead>
                    <tbody>
                        {members.map(m => (
                            <tr key={m.id}>
                                <td style={{ fontWeight: 600 }}>
                                    {m.emp_name}
                                    {user && String(m.emp_id) === String(user.emp_id) && (
                                        <span className="tprm-chip grey" style={{ marginLeft: 7 }}>you</span>
                                    )}
                                </td>
                                <td style={{ fontSize: 12, color: "var(--tprm-muted)" }}>{m.emp_mail_id}</td>
                                <td><span className="tprm-chip purple">{m.role_name}</span></td>
                                <td className="num">{m.rank_value}</td>
                                {/* The preview shows two factor enrolment here. dAssure emails a
                                    fresh code at every sign-in, so there is nothing to enrol and
                                    nobody is ever "pending". What is actually worth knowing is
                                    whether a granted person has ever used the access. */}
                                <td className="tprm-nowrap" style={{ fontSize: 12 }}>
                                    {m.last_login
                                        ? String(m.last_login).slice(0, 10)
                                        : <span className="tprm-chip amber">never</span>}
                                </td>
                                <td className="tprm-nowrap" style={{ fontSize: 12 }}>{String(m.granted_time).slice(0, 10)}</td>
                                <td>
                                    {Number(m.rank_value) <= myRank
                                        && !(user && String(m.emp_id) === String(user.emp_id)) && (
                                        <button className="tprm-btn sm" onClick={() => revoke(m)}>
                                            Revoke
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {members.length === 0 && (
                            <tr><td colSpan={6} className="tprm-empty">Nobody is assigned to this client.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="tprm-card flush">
                <div className="tprm-card-head">
                    <div className="tprm-card-title">WHAT EACH ROLE CAN DO</div>
                    {/* The description below says what a role is for. The matrix
                        says what it can actually do, capability by capability,
                        which is a table too wide to sit under this one. */}
                    <button
                        className="tprm-infobtn"
                        onClick={openMatrix}
                        title="See every capability, role by role"
                        aria-label="Open the permission matrix"
                    >
                        i
                    </button>
                    <div className="tprm-matrix-open" onClick={openMatrix}>Permission matrix</div>
                </div>
                <table className="tprm-table">
                    <thead><tr><th>Role</th><th>Level</th><th>Can grant</th><th>Description</th></tr></thead>
                    <tbody>
                        {roles.map(r => (
                            <tr key={r.role_id}>
                                <td style={{ fontWeight: 600 }}>{r.role_name}</td>
                                <td className="num">{r.rank_value}</td>
                                <td>{Number(r.can_grant) === 1 ? "Yes" : "No"}</td>
                                <td style={{ fontSize: 12, color: "var(--tprm-muted)" }}>{r.description}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {showMatrix && (
                <div className="tprm-modal-backdrop">
                    <div className="tprm-modal sheet">
                        <div className="tprm-modal-head">
                            <div>
                                <div className="tprm-modal-title">Permission matrix</div>
                                <div className="tprm-modal-sub">
                                    Read live from the permission tables. This is the same matrix
                                    the API checks on every request, so it cannot drift from
                                    what the system will actually allow.
                                    {canEditMatrix
                                        ? " Click a cell to grant or remove it. Practice Head is"
                                          + " fixed, because it is the role that edits this matrix."
                                        : " Read only. Editing it needs permission.edit, which the"
                                          + " Practice Head holds."}
                                </div>
                            </div>
                            <button
                                className="tprm-modal-close"
                                aria-label="Close"
                                onClick={() => setShowMatrix(false)}
                            >
                                &times;
                            </button>
                        </div>
                        <div className="tprm-modal-body">
                            {!matrix && <div className="tprm-loading">Reading the matrix...</div>}
                            {matrix && (
                                <div className="tprm-matrix-wrap">
                                    <table className="tprm-matrix">
                                        <thead>
                                            <tr>
                                                <th>Capability</th>
                                                {matrix.roles.map(r => (
                                                    <th key={r.role_code} title={r.role_name}>
                                                        {r.role_code}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {matrix.permissions.map(p => (
                                                <tr key={p.perm_key}>
                                                    <td>
                                                        {p.label}
                                                        <span className="tprm-matrix-key">{p.perm_key}</span>
                                                    </td>
                                                    {matrix.roles.map(r => {
                                                        const has = p.roles.includes(r.role_code);
                                                        const locked = r.role_code === "PH";
                                                        const editable = canEditMatrix && !locked;
                                                        const cell = r.role_code + ":" + p.perm_key;
                                                        const act = has ? "remove" : "grant";
                                                        return (
                                                            <td
                                                                key={r.role_code}
                                                                className={"tprm-matrix-cell"
                                                                    + (has ? " yes" : "")
                                                                    + (editable ? " editable" : "")
                                                                    + (cellBusy === cell ? " busy" : "")}
                                                                /* Drawn in the role's own colour,
                                                                   the same one the rail and the
                                                                   user list use for it. */
                                                                style={has ? {
                                                                    color: (ROLE_INFO[r.role_code]
                                                                        || {}).color,
                                                                } : undefined}
                                                                title={editable
                                                                    ? `${r.role_name}: `
                                                                      + (has ? "allowed" : "not allowed")
                                                                      + `, click to ${act}`
                                                                    : locked && canEditMatrix
                                                                        ? "Practice Head holds every"
                                                                          + " capability and cannot be"
                                                                          + " edited here"
                                                                        : `${r.role_name}: `
                                                                          + (has ? "allowed" : "not allowed")}
                                                                onClick={editable
                                                                    ? () => toggleCell(r.role_code,
                                                                        p.perm_key, has)
                                                                    : undefined}
                                                                role={editable ? "button" : undefined}
                                                                tabIndex={editable ? 0 : undefined}
                                                                onKeyDown={editable ? e => {
                                                                    if (e.key === "Enter" || e.key === " ") {
                                                                        e.preventDefault();
                                                                        toggleCell(r.role_code,
                                                                            p.perm_key, has);
                                                                    }
                                                                } : undefined}
                                                            >
                                                                {has ? "✓" : "·"}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    <div className="tprm-matrix-legend">
                                        {matrix.roles.map(r => (
                                            <div className="tprm-matrix-leg" key={r.role_code}>
                                                <span
                                                    className="tprm-matrix-dot"
                                                    style={{
                                                        background: (ROLE_INFO[r.role_code] || {}).color,
                                                    }}
                                                />
                                                <b>{r.role_code}</b> {r.role_name}
                                                <span className="tprm-matrix-rank">
                                                    level {r.rank_value}
                                                    {Number(r.can_grant) === 1 ? " · can grant" : ""}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Worth saying on the page rather than in a
                                        handbook nobody opens: a role is held per
                                        client, and a menu that hides a row is a
                                        convenience, not the control. */}
                                    <div className="tprm-note" style={{ marginTop: 18 }}>
                                        A person holds a role <b>per client</b>, so the same person can
                                        be an Engagement Manager on one engagement and an Assessor on
                                        another. Menu rows are derived from these permissions, but
                                        hiding a menu is not access control - every request is checked
                                        against this matrix again on the server.
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="tprm-modal-foot">
                            <button className="tprm-btn" onClick={() => setShowMatrix(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Deliberately no dismiss-on-backdrop-click: a stray click outside
                must never discard a part-filled form. Cancel is the way out. */}
            {form && (
                <div className="tprm-modal-backdrop">
                    <div
                        className="tprm-modal"
                        onKeyDown={e => {
                            if (e.key !== "Enter" || e.target.tagName === "TEXTAREA") return;
                            if (busy || !form.empId || !form.roleId) return;
                            e.preventDefault();
                            grant();
                        }}
                    >
                        <div className="tprm-modal-head">
                            <div>
                                <div className="tprm-modal-title">Grant access to this client</div>
                                <div className="tprm-modal-sub">
                                    They sign in with their existing Dolluz Corp credentials
                                </div>
                            </div>
                            <button
                                className="tprm-modal-close"
                                aria-label="Close"
                                onClick={() => setForm(null)}
                                disabled={busy}
                            >
                                &times;
                            </button>
                        </div>
                        <div className="tprm-modal-body">
                            <div className="tprm-field">
                                <label>Employee</label>
                                {/* Every employee in dAdmin, so this is the list
                                     that most needs the filter. */}
                                <TPRMSelect
                                    value={form.empId}
                                    onChange={v => setForm({ ...form, empId: v })}
                                    placeholder="Choose someone..."
                                    ariaLabel="Employee"
                                    options={grantable.map(e2 => ({
                                        value: e2.emp_id,
                                        label: e2.emp_name,
                                        hint: e2.emp_mail_id,
                                    }))}
                                />
                                <div className="tprm-hint">
                                    Only employees who do not already have a role on this client are listed.
                                </div>
                            </div>
                            <div className="tprm-field">
                                <label>Role</label>
                                <TPRMSelect
                                    value={form.roleId}
                                    onChange={v => setForm({ ...form, roleId: v })}
                                    placeholder="Choose a role..."
                                    ariaLabel="Role"
                                    options={grantableRoles.map(r => ({
                                        value: r.role_id,
                                        label: r.role_name,
                                        hint: `level ${r.rank_value}`,
                                    }))}
                                />
                                <div className="tprm-hint">
                                    Only roles at or below your own level appear here.
                                </div>
                            </div>
                        </div>
                        <div className="tprm-modal-foot">
                            <button className="tprm-btn" onClick={() => setForm(null)} disabled={busy}>
                                Cancel
                            </button>
                            <button
                                className="tprm-btn gold"
                                onClick={grant}
                                disabled={busy || !form.empId || !form.roleId}
                            >
                                Grant access
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default TPRMUsersAndRoles;
