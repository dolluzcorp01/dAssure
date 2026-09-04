import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPut, apiPost } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { FaFileExcel, FaFilePdf } from "react-icons/fa";
import { exportThemedExcel, exportThemedPdf } from "./utils/tprmExport";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_Findings.css";
import TPRMSelect from "./TPRM_Select";
import TPRMDateInput from "./TPRM_DateInput";

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
    const { tenantId, hasPerm, user } = useAccess();
    const [rows, setRows] = useState(null);
    const [status, setStatus] = useState("");
    // { f, reason, owner, expires, busy } while the accept form is open.
    const [accepting, setAccepting] = useState(null);
    // Which supplier's findings to show. Client side, because the rows are
    // already here and a round trip to narrow a list you are holding is waste.
    const [party, setParty] = useState("all");
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

    /* Ninety days out is the usual next look at something nobody is fixing, and
       a date already in the box is one less thing to invent. */
    const accept = (f) => setAccepting({
        f,
        reason: "",
        expires: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10),
        busy: false,
    });

    const saveAccept = async () => {
        if (!accepting || !acceptReady) return;
        setAccepting(a => ({ ...a, busy: true }));
        try {
            await apiPost(`/api/tprm/findings/${accepting.f.finding_id}/accept`, {
                reason: accepting.reason.trim(),
                expires: accepting.expires,
            });
            tprmAlert.success("Risk accepted", "It will come back for review on the date you set.");
            setAccepting(null);
            load();
        } catch (e) {
            tprmAlert.apiError(e);
            setAccepting(a => (a ? { ...a, busy: false } : a));
        }
    };

    if (!tenantId) {
        return <div className="tprm-page"><div className="tprm-note warn">Select a client first.</div></div>;
    }
    if (!rows) return <div className="tprm-loading">Loading findings...</div>;

    /* The same three the route insists on, checked here so the button can say
       no before the round trip rather than after it. */
    const acceptReady = !!accepting
        && accepting.reason.trim().length >= 20
        && !!accepting.expires;

    /* Built from every row loaded, so the list stays complete even while it is
       filtered down to one of them. */
    const parties = [...new Set(rows.map(r => r.third_party_name))].sort();
    const shown = party === "all" ? rows : rows.filter(r => r.third_party_name === party);

    const breached = shown.filter(r => Number(r.breached) === 1).length;

    /* What a person opens this page to find out, before reading a single row:
       what is urgent, what is late, and what has been signed off rather than
       fixed. Counted over everything loaded, so the numbers do not move when
       the filters do. */
    const openish = r => ["open", "in_progress", "evidence_under_review"].includes(r.status);
    const cards = [
        ["Critical open", shown.filter(r => r.severity === "Critical" && openish(r)).length,
            "var(--tprm-red)"],
        ["High open", shown.filter(r => r.severity === "High" && openish(r)).length,
            "var(--tprm-amber)"],
        ["Past due", breached, "var(--tprm-red)"],
        ["Risk accepted", shown.filter(r => r.status === "accepted").length,
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

    /* Exports what is on screen. An export that quietly carries rows the person
       had filtered out is worse than no export - they will send it on. */
    const exportRows = () => shown.map(f => ({
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
        filterLabel: [party === "all" ? "All third parties" : party,
            status === "all" ? "All statuses" : status,
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
                        style={{ width: 210 }}
                        value={party} onChange={setParty}
                        ariaLabel="Filter by third party"
                        options={[
                            { value: "all", label: "All third parties" },
                            ...parties.map(n => ({ value: n, label: n })),
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
                        {shown.length} {shown.length === 1 ? "finding" : "findings"}
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
                            <th>Severity</th><th>Evidence</th><th>Status</th><th>Due</th>
                            <th>Days left</th><th className="tprm-col-actions" />
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map(f => (
                            <tr key={f.finding_id} className={Number(f.breached) === 1 ? "danger" : ""}>
                                <td className="num" style={{ fontWeight: 700 }}>{f.finding_ref}</td>
                                <td>{f.third_party_name}</td>
                                <td className="num" style={{ fontSize: 11.5 }}>{f.control_ref}</td>
                                <td style={{ maxWidth: 340, fontSize: 12.5 }}>{f.title}</td>
                                <td><span className={"tprm-chip " + SEV_CLASS[f.severity]}>{f.severity}</span></td>
                                <td className="tprm-nowrap">
                                    {Number(f.evidence_count)
                                        ? <span className="tprm-chip green">
                                            {f.evidence_count} file
                                            {Number(f.evidence_count) > 1 ? "s" : ""}
                                        </span>
                                        : <span className="tprm-chip grey">none</span>}
                                </td>
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
                                            {/* Closing needs proof. Saying so on the
                                                button beats letting someone click and
                                                be refused - and it points at the action
                                                that IS available instead. */}
                                            <button
                                                className="tprm-btn sm" style={{ marginRight: 5 }}
                                                disabled={!Number(f.evidence_count)}
                                                title={Number(f.evidence_count)
                                                    ? `Close - ${f.evidence_count} file`
                                                      + `${Number(f.evidence_count) > 1 ? "s" : ""} attached`
                                                    : `Nothing is attached to ${f.control_ref}. `
                                                      + "Attach the proof on the assessment, or "
                                                      + "use Accept risk."}
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
                            <tr><td colSpan={10} className="tprm-empty">
                                No findings match that filter.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            {/* Accepting a risk is one decision, so it is one form. It used to be
                a styled dialog for the reason and then two native window.prompt
                boxes for the owner and the date - which is why the browser's own
                "localhost:3000 says" appeared over the app's chrome, and why you
                could not go back a step or see what you had already typed. */}
            {accepting && (
                <div className="tprm-modal-backdrop">
                    <div className="tprm-modal">
                        <div className="tprm-modal-head">
                            <div>
                                <div className="tprm-modal-title">
                                    Accept the risk on {accepting.f.finding_ref}
                                </div>
                                <div className="tprm-modal-sub">
                                    {accepting.f.control_ref} &middot; {accepting.f.third_party_name}
                                </div>
                            </div>
                            <button
                                className="tprm-modal-close"
                                aria-label="Close"
                                onClick={() => setAccepting(null)}
                                disabled={accepting.busy}
                            >
                                &times;
                            </button>
                        </div>

                        <div className="tprm-modal-body">
                            <div className="tprm-note warn" style={{ marginBottom: 16 }}>
                                This records a decision <b>not to fix</b>. It is not a way to close
                                a finding quietly: the reason, the owner and the review date all go
                                on the audit record and onto the issued report.
                            </div>

                            <div className="tprm-field">
                                <label>Why is this acceptable<span className="req"> *</span></label>
                                <textarea
                                    className="tprm-textarea"
                                    autoFocus
                                    value={accepting.reason}
                                    placeholder="What makes this tolerable, and what compensates for it"
                                    onChange={e => setAccepting(a => ({ ...a, reason: e.target.value }))}
                                />
                                <div className="tprm-hint">
                                    {accepting.reason.trim().length} of 20 characters minimum.
                                </div>
                            </div>

                            {/* Not a field. You are the one clicking, so you are the
                                one accepting - typing that in was only a way to put
                                somebody else's name on your decision. */}
                            <div className="tprm-field">
                                <label>Accepted by</label>
                                <div className="tprm-accept-by">
                                    {user ? user.emp_name : "you"}
                                    <span> &middot; recorded when you save</span>
                                </div>
                            </div>

                            <div className="tprm-field">
                                <label>Bring it back for review on<span className="req"> *</span></label>
                                <TPRMDateInput
                                    value={accepting.expires}
                                    min={new Date(Date.now() + 864e5).toISOString().slice(0, 10)}
                                    onChange={e => setAccepting(a => ({ ...a, expires: e.target.value }))}
                                />
                                <div className="tprm-hint">
                                    Not today's date - the date this comes back. Acceptance is
                                    temporary, which is what separates it from ignoring the finding.
                                </div>
                            </div>
                        </div>

                        <div className="tprm-modal-foot">
                            <button
                                className="tprm-btn"
                                onClick={() => setAccepting(null)}
                                disabled={accepting.busy}
                            >
                                Cancel
                            </button>
                            <button
                                className={"tprm-btn gold" + (accepting.busy ? " loading" : "")}
                                onClick={saveAccept}
                                disabled={accepting.busy || !acceptReady}
                                title={acceptReady ? undefined
                                    : "A reason of at least 20 characters, and a review date"}
                            >
                                {accepting.busy ? "Recording..." : "Accept the risk"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default TPRMFindings;
