import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPut, apiPost } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { FaFileExcel, FaFilePdf } from "react-icons/fa";
import { exportThemedExcel, exportThemedPdf } from "./utils/tprmExport";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_Findings.css";

const SEV_CLASS = { Critical: "red", High: "amber", Medium: "blue", Low: "grey" };

function TPRMFindings() {
    const { tenantId, hasPerm } = useAccess();
    const [rows, setRows] = useState(null);
    const [status, setStatus] = useState("");
    const [severity, setSeverity] = useState("all");

    const load = useCallback(() => {
        if (!tenantId) return;
        const q = new URLSearchParams();
        if (status) q.set("status", status);
        if (severity !== "all") q.set("severity", severity);
        apiJson(`/api/tprm/findings/${tenantId}/list?${q}`).then(setRows).catch(() => setRows([]));
    }, [tenantId, status, severity]);

    useEffect(() => { load(); }, [load]);

    const setFindingStatus = async (f, newStatus) => {
        try {
            await apiPut(`/api/tprm/findings/${f.finding_id}`, { status: newStatus });
            load();
        } catch (e) { tprmAlert.apiError(e); }
    };

    const accept = async (f) => {
        const reason = await tprmAlert.reason(
            `Accept the risk on ${f.finding_ref}?`,
            "Why is this acceptable? Twenty characters minimum. Acceptance is temporary and needs a review date.",
            20);
        if (!reason) return;
        const owner = window.prompt("Who is accepting this risk? Name and role.");
        if (!owner) return;
        const expires = window.prompt("Review date (YYYY-MM-DD)");
        if (!expires) return;
        try {
            await apiPost(`/api/tprm/findings/${f.finding_id}/accept`, { reason, owner, expires });
            tprmAlert.success("Risk accepted", "It will come back for review on the date you set.");
            load();
        } catch (e) { tprmAlert.apiError(e); }
    };

    if (!tenantId) {
        return <div className="tprm-page"><div className="tprm-note warn">Select a client first.</div></div>;
    }
    if (!rows) return <div className="tprm-loading">Loading findings...</div>;

    const breached = rows.filter(r => Number(r.breached) === 1).length;

    /* One column spec, both outputs. Excel and PDF differ only in how wide a
       column may get, never in what is in it, which is why the two files look
       like the same document. */
    const EXPORT_COLUMNS = [
        { key: "finding_ref", label: "Ref", width: 16, pdfWidth: 70 },
        { key: "third_party_name", label: "Third party", width: 30, pdfWidth: 130 },
        { key: "control_ref", label: "Control", width: 12, pdfWidth: 60 },
        { key: "title", label: "Finding", width: 46, wrap: true, pdfWidth: 200 },
        { key: "severity", label: "Severity", width: 13, pdfWidth: 62 },
        { key: "status", label: "Status", width: 14, pdfWidth: 66 },
        { key: "due_date", label: "Due", width: 13, pdfWidth: 62 },
        { key: "days_left", label: "Days left", width: 11, align: "right", pdfWidth: 58 },
    ];

    const exportRows = () => rows.map(f => ({
        finding_ref: f.finding_ref,
        third_party_name: f.third_party_name,
        control_ref: f.control_ref,
        title: f.title || "",
        severity: f.severity,
        status: f.status,
        due_date: f.due_date ? String(f.due_date).slice(0, 10) : "",
        days_left: f.days_remaining,
    }));

    const exportArgs = () => ({
        moduleName: "dTPRM",
        sheetTitle: "Findings",
        columns: EXPORT_COLUMNS,
        rows: exportRows(),
        filterLabel: [status === "all" ? "All statuses" : status,
            severity === "all" ? "All severities" : severity].filter(Boolean).join(" · "),
        statusKey: "severity",
    });

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <div className="tprm-page-sub">
                        {breached > 0
                            ? `${breached} findings are past their agreed date.`
                            : "Nothing is past its agreed date."}
                        {" "}SLA clocks pause while a case is on hold.
                    </div>
                </div>
                <div className="tprm-page-actions">
                    <button
                        className="tprm-btn sm"
                        disabled={rows.length === 0}
                        onClick={() => exportThemedExcel({ ...exportArgs(), filename: "dTPRM_Findings.xlsx" })}
                    >
                        <FaFileExcel style={{ marginRight: 6 }} />Excel
                    </button>
                    <button
                        className="tprm-btn sm"
                        disabled={rows.length === 0}
                        onClick={() => exportThemedPdf({ ...exportArgs(), filename: "dTPRM_Findings.pdf" })}
                    >
                        <FaFilePdf style={{ marginRight: 6 }} />PDF
                    </button>
                    <select
                        className="tprm-select" style={{ width: 180 }}
                        value={status} onChange={e => setStatus(e.target.value)}
                    >
                        <option value="">Open and in progress</option>
                        <option value="all">All statuses</option>
                        <option value="open">Open</option>
                        <option value="in_progress">In progress</option>
                        <option value="evidence_under_review">Evidence under review</option>
                        <option value="closed">Closed</option>
                        <option value="accepted">Risk accepted</option>
                    </select>
                    <select
                        className="tprm-select" style={{ width: 140 }}
                        value={severity} onChange={e => setSeverity(e.target.value)}
                    >
                        <option value="all">All severities</option>
                        <option value="Critical">Critical</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                    </select>
                </div>
            </div>

            <div className="tprm-card flush">
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Ref</th><th>Third party</th><th>Control</th><th>Finding</th>
                            <th>Severity</th><th>Status</th><th>Due</th><th>Days left</th><th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(f => (
                            <tr key={f.finding_id} className={Number(f.breached) === 1 ? "danger" : ""}>
                                <td className="num" style={{ fontWeight: 700 }}>{f.finding_ref}</td>
                                <td>{f.third_party_name}</td>
                                <td className="num" style={{ fontSize: 11.5 }}>{f.control_ref}</td>
                                <td style={{ maxWidth: 340, fontSize: 12.5 }}>{f.title}</td>
                                <td><span className={"tprm-chip " + SEV_CLASS[f.severity]}>{f.severity}</span></td>
                                <td>
                                    <span className={"tprm-chip " + (
                                        f.status === "closed" ? "green"
                                            : f.status === "accepted" ? "grey" : "blue")}>
                                        {String(f.status).replace(/_/g, " ")}
                                    </span>
                                </td>
                                <td style={{ fontSize: 12 }}>{String(f.due_at).slice(0, 10)}</td>
                                <td
                                    className="num"
                                    style={{
                                        color: Number(f.breached) === 1 ? "var(--tprm-red)" : "inherit",
                                        fontWeight: 600,
                                    }}
                                >
                                    {f.days_remaining}
                                </td>
                                <td>
                                    {hasPerm("finding.manage") && !["closed", "accepted"].includes(f.status) && (
                                        <>
                                            {f.status === "open" && (
                                                <button
                                                    className="tprm-btn sm" style={{ marginRight: 5 }}
                                                    onClick={() => setFindingStatus(f, "in_progress")}
                                                >
                                                    Start
                                                </button>
                                            )}
                                            <button
                                                className="tprm-btn sm" style={{ marginRight: 5 }}
                                                onClick={() => setFindingStatus(f, "closed")}
                                            >
                                                Close
                                            </button>
                                        </>
                                    )}
                                    {hasPerm("risk.accept") && !["closed", "accepted"].includes(f.status) && (
                                        <button className="tprm-btn sm" onClick={() => accept(f)}>
                                            Accept risk
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={9} className="tprm-empty">
                                No findings match that filter.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default TPRMFindings;
