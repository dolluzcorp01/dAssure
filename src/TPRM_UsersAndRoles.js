import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPost, apiDelete } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_UsersAndRoles.css";
import TPRMSelect from "./TPRM_Select";

function TPRMUsersAndRoles() {
    const { tenantId, tenant, user } = useAccess();
    const [members, setMembers] = useState(null);
    const [roles, setRoles] = useState([]);
    const [grantable, setGrantable] = useState([]);
    const [form, setForm] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        if (!tenantId) return;
        apiJson(`/api/tprm/clients/${tenantId}/members`).then(setMembers).catch(() => setMembers([]));
        apiJson(`/api/tprm/clients/${tenantId}/grantable-employees`).then(setGrantable).catch(() => {});
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { apiJson("/api/tprm/clients/roles").then(setRoles).catch(() => {}); }, []);

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
                                {/* The preview shows two factor enrolment here. dTprm emails a
                                    fresh code at every sign-in, so there is nothing to enrol and
                                    nobody is ever "pending". What is actually worth knowing is
                                    whether a granted person has ever used the access. */}
                                <td style={{ fontSize: 12 }}>
                                    {m.last_login
                                        ? String(m.last_login).slice(0, 10)
                                        : <span className="tprm-chip amber">never</span>}
                                </td>
                                <td style={{ fontSize: 12 }}>{String(m.granted_time).slice(0, 10)}</td>
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
                <div className="tprm-card-head"><div className="tprm-card-title">WHAT EACH ROLE CAN DO</div></div>
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
