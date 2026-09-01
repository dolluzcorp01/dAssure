import React, { useEffect, useState, useCallback } from "react";
import { apiJson } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import "./TPRM_AuditTrail.css";

function TPRMAuditTrail() {
    const { tenantId, tenant } = useAccess();
    const [rows, setRows] = useState(null);
    const [action, setAction] = useState("");
    const [expanded, setExpanded] = useState(null);

    const load = useCallback(() => {
        if (!tenantId) return;
        const q = new URLSearchParams({ limit: "300" });
        if (action) q.set("action", action);
        apiJson(`/api/tprm/audit/${tenantId}/list?${q}`).then(setRows).catch(() => setRows([]));
    }, [tenantId, action]);

    useEffect(() => { load(); }, [load]);

    if (!tenantId) {
        return <div className="tprm-page"><div className="tprm-note warn">Select a client first.</div></div>;
    }
    if (!rows) return <div className="tprm-loading">Loading the audit trail...</div>;

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <div className="tprm-page-sub">
                        {tenant ? tenant.tenant_name : ""} &nbsp;|&nbsp; Append only. There is no
                        endpoint anywhere in this application that edits or deletes these rows.
                    </div>
                </div>
                <div className="tprm-page-actions">
                    <select
                        className="tprm-select" style={{ width: 210 }}
                        value={action} onChange={e => setAction(e.target.value)}
                    >
                        <option value="">Everything</option>
                        <option value="assessment">Assessment actions</option>
                        <option value="response">Response changes</option>
                        <option value="evidence">Evidence actions</option>
                        <option value="finding">Finding actions</option>
                        <option value="report">Report actions</option>
                        <option value="role">Role grants</option>
                        <option value="intake">Intake actions</option>
                        <option value="methodology">Methodology changes</option>
                    </select>
                </div>
            </div>

            <div className="tprm-card flush">
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>When</th><th>Who</th><th>Action</th><th>Entity</th>
                            <th>Reason</th><th>IP</th><th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <React.Fragment key={r.audit_id}>
                                <tr>
                                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                                        {String(r.occurred_time).slice(0, 19).replace("T", " ")}
                                    </td>
                                    <td style={{ fontSize: 12.5 }}>{r.actor_name}</td>
                                    <td><span className="tprm-chip blue">{r.action}</span></td>
                                    <td style={{ fontSize: 11.5, color: "var(--tprm-muted)" }}>
                                        {r.entity_type} {r.entity_id ? `#${r.entity_id}` : ""}
                                    </td>
                                    <td style={{ fontSize: 11.5, color: "var(--tprm-muted)", maxWidth: 280 }}>
                                        {r.reason}
                                    </td>
                                    <td className="num" style={{ fontSize: 11, color: "var(--tprm-faint)" }}>
                                        {r.ip_addr}
                                    </td>
                                    <td>
                                        {(r.before_json || r.after_json) && (
                                            <button
                                                className="tprm-btn sm"
                                                onClick={() => setExpanded(
                                                    expanded === r.audit_id ? null : r.audit_id)}
                                            >
                                                {expanded === r.audit_id ? "Hide" : "Detail"}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                                {expanded === r.audit_id && (
                                    <tr>
                                        <td colSpan={7} className="tprm-audit-detail">
                                            {r.before_json && (
                                                <div>
                                                    <b>Before</b>
                                                    <pre>{JSON.stringify(
                                                        typeof r.before_json === "string"
                                                            ? JSON.parse(r.before_json) : r.before_json,
                                                        null, 2)}</pre>
                                                </div>
                                            )}
                                            {r.after_json && (
                                                <div>
                                                    <b>After</b>
                                                    <pre>{JSON.stringify(
                                                        typeof r.after_json === "string"
                                                            ? JSON.parse(r.after_json) : r.after_json,
                                                        null, 2)}</pre>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={7} className="tprm-empty">Nothing recorded yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default TPRMAuditTrail;
