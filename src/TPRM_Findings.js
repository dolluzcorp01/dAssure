import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPut, apiPost } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { FaFileExcel, FaFilePdf } from "react-icons/fa";
import { exportThemedExcel, exportThemedPdf } from "./utils/tprmExport";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_Findings.css";
import TPRMSelect from "./TPRM_Select";

const SEV_CLASS = { Critical: "red", High: "amber", Medium: "blue", Low: "grey" };

/* Status carried one colour for everything that was not closed, so an item
   nobody had touched looked exactly like one being actively worked. These are
   different situations and the colour is what you scan, not the word:
   red is untouched, amber is moving, blue is waiting on us, green is done and
   purple is a decision not to fix. */
const STATUS_CLASS = {
    open: "red",
    in_progress: "amber",
    evidence_under_review: "blue",
    closed: "green",
    accepted: "purple",
};

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

    /* What a person opens this page to find out, before reading a single row:
       what is urgent, what is late, and what has been signed off rather than
       fixed. Counted over everything loaded, so the numbers do not move when
       the filters do. */
    const openish = r => ["open", "in_progress", "evidence_under_review"].includes(r.status);
    const cards = [
        ["Critical open", rows.filter(r => r.severity === "Critical" && openish(r)).length,
            "var(--tprm-red)"],
        ["High open", rows.filter(r => r.severity === "High" && openish(r)).length,
            "var(--tprm-amber)"],
        ["Past due", breached, "var(--tprm-red)"],
        ["Risk accepted", rows.filter(r => r.status === "accepted").length,
            "var(--tprm-purple)"],
    ];

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
                    <TPRMSelect
                        style={{ width: 210 }}
                        value={status} onChange={setStatus}
                        ariaLabel="Filter by status"
                        options={[
                            { value: "", label: "Open and in progress" },
                            { value: "all", label: "All statuses" },
                            { value: "open", label: "Open" },
                            { value: "in_progress", label: "In progress" },
                            { value: "evidence_under_review", label: "Evidence under review" },
                            { value: "closed", label: "Closed" },
                            { value: "accepted", label: "Risk accepted" },
                        ]}
                    />
                    <TPRMSelect
                        style={{ width: 160 }}
                        value={severity} onChange={setSeverity}
                        ariaLabel="Filter by severity"
                        options={[
                            { value: "all", label: "All severities" },
                            { value: "Critical", label: "Critical" },
                            { value: "High", label: "High" },
                            { value: "Medium", label: "Medium" },
                            { value: "Low", label: "Low" },
                        ]}
                    />
                </div>
            </div>

            <div className="tprm-grid k4" style={{ marginBottom: 18 }}>
                {cards.map(([label, n, colour]) => (
                    <div className="tprm-card tprm-kpi" key={label} style={{ borderTopColor: colour }}>
                        <div className="tprm-kpi-value" style={{ color: n ? colour : "var(--tprm-faint)" }}>
                            {n}
                        </div>
                        <div className="tprm-kpi-sub">{label}</div>
                    </div>
                ))}
            </div>

            <div className="tprm-card flush">
                {/* How many rows the filters are actually showing. A table with
                    no count leaves you counting, and the answer changes every
                    time the filter does. */}
                <div className="tprm-card-head">
                    <div className="tprm-card-title">
                        {rows.length} {rows.length === 1 ? "finding" : "findings"}
                    </div>
                    <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--tprm-muted)" }}>
                        {status === "all" ? "All statuses" : "Open and in progress"}
                        {severity ? ` · ${severity}` : " · all severities"}
                    </div>
                </div>
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
                                    <span className={"tprm-chip "
                                        + (STATUS_CLASS[f.status] || "grey")}>
                                        {String(f.status).replace(/_/g, " ")}
                                    </span>
                                </td>
                                <td className="tprm-nowrap" style={{ fontSize: 12 }}>{String(f.due_at).slice(0, 10)}</td>
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
