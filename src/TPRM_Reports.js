import React, { useEffect, useState, useCallback, useRef } from "react";
import { apiJson, apiPost, apiDownload, apiBlob, saveBlob } from "./utils/api";
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
    // The report being read on screen, and which row is still fetching one.
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(null);
    const previewUrl = useRef(null);

    const load = useCallback(() => {
        if (!tenantId) return;
        apiJson(`/api/tprm/reports/${tenantId}/issuances`).then(setIssuances).catch(() => setIssuances([]));
        apiJson("/api/tprm/assessments/list")
            .then(rows => setReady(rows.filter(r =>
                Number(r.tenant_id) === Number(tenantId) && r.state === "approved")))
            .catch(() => {});
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    // An object URL is a live handle on memory the browser will hold until it
    // is told otherwise. Closing the modal releases it; so does leaving the
    // page with one still open.
    useEffect(() => () => {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    }, []);

    const releasePreview = () => {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
        setPreview(null);
    };

    /* Read it before it goes anywhere. The report used to arrive as a download,
       which meant leaving the app, finding the file, opening it, and doing that
       again for every correction - to check something you were about to send to
       a client under your own name. The bytes shown here are the same bytes the
       Download button saves and the same bytes Issue sends, because all three
       come from one fetch of one endpoint. */
    const openPreview = async (a) => {
        setPreviewing(a.assessment_id);
        try {
            const { blob, filename } = await apiBlob(
                `/api/tprm/reports/assessments/${a.assessment_id}/pdf`, "report.pdf");
            if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
            previewUrl.current = URL.createObjectURL(blob);
            setPreview({ a, blob, filename, url: previewUrl.current });
        } catch (e) { tprmAlert.apiError(e); } finally { setPreviewing(null); }
    };

    /* One address per person, and each one has to look like an address. The
       server hands the list to the mailer, which drops what it cannot parse
       without complaining - so a typo here reads as a report that was issued
       to somebody who never received it. */
    const addresses = recipients.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const badAddresses = addresses.filter(s => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    const canIssue = addresses.length > 0 && badAddresses.length === 0;

    const issue = async () => {
        // Issuing is the one action here that reaches outside the building. It
        // emails a confidential document to named people and freezes the
        // assessment for good, and neither half can be taken back, so the list
        // is read back before it goes.
        const ok = await tprmAlert.confirm(
            `Send this report to ${addresses.length} recipient${addresses.length > 1 ? "s" : ""}?`,
            `${issuing.third_party_name} - ${addresses.join(", ")}. `
            + "The PDF is emailed with its hash recorded, and the assessment is "
            + "locked from any further change.",
            "Yes, issue it");
        if (!ok) return;

        setBusy(true);
        try {
            const r = await apiPost(`/api/tprm/reports/assessments/${issuing.assessment_id}/issue`,
                { recipients: addresses.join(", ") });
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
                                            className={"tprm-btn sm"
                                                + (previewing === a.assessment_id ? " loading" : "")}
                                            style={{ marginRight: 6 }}
                                            onClick={() => openPreview(a)}
                                            disabled={previewing === a.assessment_id}
                                        >
                                            {previewing === a.assessment_id ? "Building..." : "Preview PDF"}
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
                                <td className="tprm-nowrap" style={{ fontSize: 12 }}>
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

            {preview && (
                <div className="tprm-modal-backdrop">
                    <div className="tprm-modal doc">
                        <div className="tprm-modal-head">
                            <div>
                                <div className="tprm-modal-title">{preview.a.third_party_name}</div>
                                <div className="tprm-modal-sub">
                                    {preview.filename} &middot; draft until it is issued
                                </div>
                            </div>
                            <button
                                className="tprm-modal-close"
                                aria-label="Close"
                                onClick={releasePreview}
                            >
                                &times;
                            </button>
                        </div>
                        <div className="tprm-modal-body">
                            <iframe
                                className="tprm-docframe"
                                title={`${preview.a.third_party_name} report`}
                                src={preview.url}
                            />
                        </div>
                        <div className="tprm-modal-foot">
                            <button className="tprm-btn" onClick={releasePreview}>Close</button>
                            {/* Saves the bytes already on screen rather than
                                rebuilding the PDF, so the file on disk cannot
                                differ from the one just read. */}
                            <button
                                className="tprm-btn navy"
                                onClick={() => saveBlob(preview.blob, preview.filename)}
                            >
                                Download PDF
                            </button>
                            {hasPerm("report.issue") && (
                                <button
                                    className="tprm-btn gold"
                                    onClick={() => { const a = preview.a; releasePreview(); setIssuing(a); }}
                                >
                                    Issue to client
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Deliberately no dismiss-on-backdrop-click: a stray click outside
                must never discard a part-filled form. Cancel is the way out. */}
            {issuing && (
                <div className="tprm-modal-backdrop">
                    <div
                        className="tprm-modal"
                        onKeyDown={e => {
                            if (e.key !== "Enter" || e.target.tagName === "TEXTAREA") return;
                            if (busy || !canIssue) return;
                            e.preventDefault();
                            issue();
                        }}
                    >
                        <div className="tprm-modal-head">
                            <div>
                                <div className="tprm-modal-title">Issue the report</div>
                                <div className="tprm-modal-sub">
                                    {issuing.third_party_name} to {tenant ? tenant.tenant_name : ""}
                                </div>
                            </div>
                            <button
                                className="tprm-modal-close"
                                aria-label="Close"
                                onClick={() => setIssuing(null)}
                                disabled={busy}
                            >
                                &times;
                            </button>
                        </div>
                        <div className="tprm-modal-body">
                            <div className="tprm-field">
                                <label>Recipients</label>
                                <input
                                    autoFocus
                                    className="tprm-input"
                                    value={recipients}
                                    placeholder="ciso@client.com, procurement@client.com"
                                    onChange={e => setRecipients(e.target.value)}
                                />
                                <div className={"tprm-hint" + (badAddresses.length ? " bad" : "")}>
                                    {badAddresses.length
                                        ? `That is not an email address: ${badAddresses.join(", ")}`
                                        : "Comma separated. The assessment moves to Issued and can no "
                                          + "longer be edited."}
                                </div>
                            </div>
                        </div>
                        <div className="tprm-modal-foot">
                            <button className="tprm-btn" onClick={() => setIssuing(null)} disabled={busy}>
                                Cancel
                            </button>
                            <button
                                className={"tprm-btn gold" + (busy ? " loading" : "")}
                                onClick={issue}
                                disabled={busy || !canIssue}
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
