import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPost, apiDownload } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_Reports.css";

function TPRMReports() {
    const { tenantId, tenant, hasPerm } = useAccess();
    const [issuances, setIssuances] = useState(null);
    const [ready, setReady] = useState([]);
    const [issuing, setIssuing] = useState(null);
    const [recipients, setRecipients] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        if (!tenantId) return;
        apiJson(`/api/tprm/reports/${tenantId}/issuances`).then(setIssuances).catch(() => setIssuances([]));
        apiJson("/api/tprm/assessments/list")
            .then(rows => setReady(rows.filter(r =>
                Number(r.tenant_id) === Number(tenantId) && r.state === "approved")))
            .catch(() => {});
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    const issue = async () => {
        setBusy(true);
        try {
            const r = await apiPost(`/api/tprm/reports/assessments/${issuing.assessment_id}/issue`,
                { recipients });
            tprmAlert.success(`Report ${r.reference} issued`,
                "The PDF is queued for delivery and its hash is recorded.");
            setIssuing(null); setRecipients("");
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    if (!tenantId) {
        return <div className="tprm-page"><div className="tprm-note warn">Select a client first.</div></div>;
    }
    if (!issuances) return <div className="tprm-loading">Loading...</div>;

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <h1 className="tprm-page-title">Reports</h1>
                    <div className="tprm-page-sub">
                        Every issued report is recorded with its recipients and a SHA-256 of the
                        exact file that was sent.
                    </div>
                </div>
                <div className="tprm-page-actions">
                    <button
                        className="tprm-btn navy"
                        onClick={() => apiDownload(
                            `/api/tprm/reports/${tenantId}/register.xlsx`, "register.xlsx")
                            .catch(e => tprmAlert.apiError(e))}
                    >
                        Export the third party register
                    </button>
                </div>
            </div>

            {ready.length > 0 && (
                <div className="tprm-card flush" style={{ marginBottom: 18 }}>
                    <div className="tprm-card-head">
                        <div className="tprm-card-title">APPROVED AND READY TO ISSUE ({ready.length})</div>
                    </div>
                    <table className="tprm-table">
                        <thead>
                            <tr><th>Ref</th><th>Third party</th><th>Tier</th><th>Residual</th><th></th></tr>
                        </thead>
                        <tbody>
                            {ready.map(a => (
                                <tr key={a.assessment_id}>
                                    <td className="num">{a.ref_code}</td>
                                    <td style={{ fontWeight: 600 }}>{a.third_party_name}</td>
                                    <td>
                                        <span className={"tprm-chip " + (
                                            a.tier === 1 ? "red" : a.tier === 2 ? "amber" : "green")}>
                                            TIER {a.tier}
                                        </span>
                                    </td>
                                    <td className="num">{a.residual_score} {a.residual_band}</td>
                                    <td>
                                        <button
                                            className="tprm-btn sm" style={{ marginRight: 6 }}
                                            onClick={() => apiDownload(
                                                `/api/tprm/reports/assessments/${a.assessment_id}/pdf`,
                                                "report.pdf").catch(e => tprmAlert.apiError(e))}
                                        >
                                            Preview PDF
                                        </button>
                                        {hasPerm("report.issue") && (
                                            <button
                                                className="tprm-btn sm primary"
                                                onClick={() => setIssuing(a)}
                                            >
                                                Issue to client
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="tprm-card flush">
                <div className="tprm-card-head">
                    <div className="tprm-card-title">ISSUANCE HISTORY</div>
                </div>
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Reference</th><th>Third party</th><th>Recipients</th>
                            <th>Issued by</th><th>Issued at</th><th>Integrity</th>
                        </tr>
                    </thead>
                    <tbody>
                        {issuances.map(r => (
                            <tr key={r.report_issue_id}>
                                <td className="num" style={{ fontWeight: 700 }}>{r.doc_reference}</td>
                                <td>{r.third_party_name}</td>
                                <td style={{ fontSize: 12, color: "var(--tprm-muted)" }}>{r.recipients}</td>
                                <td style={{ fontSize: 12 }}>{r.issued_by_name}</td>
                                <td style={{ fontSize: 12 }}>
                                    {String(r.issued_time).slice(0, 16).replace("T", " ")}
                                </td>
                                <td
                                    className="num"
                                    style={{ fontSize: 10.5, color: "var(--tprm-faint)" }}
                                    title={r.sha256}
                                >
                                    {r.sha256 ? r.sha256.slice(0, 12) + "..." : "-"}
                                </td>
                            </tr>
                        ))}
                        {issuances.length === 0 && (
                            <tr><td colSpan={6} className="tprm-empty">
                                No reports have been issued yet.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Deliberately no dismiss-on-backdrop-click: a stray click outside
                must never discard a part-filled form. Cancel is the way out. */}
            {issuing && (
                <div className="tprm-modal-backdrop">
                    <div className="tprm-modal">
                        <div className="tprm-modal-head">
                            <div className="tprm-modal-title">Issue the report</div>
                            <div className="tprm-modal-sub">
                                {issuing.third_party_name} to {tenant ? tenant.tenant_name : ""}
                            </div>
                        </div>
                        <div className="tprm-modal-body">
                            <div className="tprm-field">
                                <label>Recipients</label>
                                <input
                                    className="tprm-input"
                                    value={recipients}
                                    placeholder="ciso@client.com, procurement@client.com"
                                    onChange={e => setRecipients(e.target.value)}
                                />
                                <div className="tprm-hint">
                                    Comma separated. The assessment moves to Issued and can no longer
                                    be edited.
                                </div>
                            </div>
                        </div>
                        <div className="tprm-modal-foot">
                            <button className="tprm-btn" onClick={() => setIssuing(null)} disabled={busy}>
                                Cancel
                            </button>
                            <button
                                className="tprm-btn primary"
                                onClick={issue}
                                disabled={busy || !recipients.trim()}
                            >
                                {busy ? "Issuing..." : "Issue report"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default TPRMReports;
