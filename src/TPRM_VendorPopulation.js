import React, { useEffect, useState, useCallback, useRef } from "react";
import { apiJson, apiPost, apiPut, apiUpload, apiDownload, API_BASE } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_VendorPopulation.css";

// The pipeline, left to right. Each step is a tab rather than a locked wizard,
// because real engagements loop back: a supplier list arrives in three parts
// and triage restarts while classification is still being reviewed.
const STEPS = [
    { key: "template", label: "Intake template" },
    { key: "upload", label: "Upload list" },
    { key: "classify", label: "Classify" },
    { key: "triage", label: "Triage" },
    { key: "tiering", label: "Tiering" },
    { key: "distribute", label: "Distribution" },
    { key: "import", label: "Import responses" },
];

function TPRMVendorPopulation() {
    const { tenantId, tenant } = useAccess();
    const [step, setStep] = useState("template");
    const [funnel, setFunnel] = useState(null);

    const loadFunnel = useCallback(() => {
        if (!tenantId) return;
        apiJson(`/api/tprm/vendors/${tenantId}/funnel`).then(setFunnel).catch(() => {});
    }, [tenantId]);

    useEffect(() => { loadFunnel(); }, [loadFunnel, step]);

    if (!tenantId) {
        return <div className="tprm-page"><div className="tprm-note warn">Select a client first.</div></div>;
    }

    const Body = {
        template: StepTemplate, upload: StepUpload, classify: StepClassify,
        triage: StepTriage, tiering: StepTiering, distribute: StepDistribute,
        import: StepImport,
    }[step];

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <h1 className="tprm-page-title">Vendor population</h1>
                    <div className="tprm-page-sub">
                        {tenant ? tenant.tenant_name : ""} &nbsp;|&nbsp; From a supplier list to issued questionnaires
                    </div>
                </div>
            </div>

            {funnel && (
                <div className="tprm-funnel">
                    {[
                        ["Received", funnel.received], ["Classified", funnel.classified],
                        ["In scope", funnel.in_scope], ["Tiered", funnel.tiered],
                        ["Issued", funnel.issued], ["Assessed", funnel.assessed],
                    ].map(([label, n], idx, arr) => (
                        <React.Fragment key={label}>
                            <div className="tprm-funnel-node">
                                <div className="tprm-funnel-n">{n}</div>
                                <div className="tprm-funnel-l">{label}</div>
                            </div>
                            {idx < arr.length - 1 && <div className="tprm-funnel-arrow">&rsaquo;</div>}
                        </React.Fragment>
                    ))}
                </div>
            )}

            <div className="tprm-steps">
                {STEPS.map((s, i) => (
                    <button
                        key={s.key}
                        className={"tprm-step" + (step === s.key ? " active" : "")}
                        onClick={() => setStep(s.key)}
                    >
                        <span className="n">{i + 1}</span>{s.label}
                    </button>
                ))}
            </div>

            <Body tenantId={tenantId} tenant={tenant} onChanged={loadFunnel} goto={setStep} />
        </div>
    );
}

/* =============================================== 1. the intake template */
function StepTemplate({ tenantId, tenant }) {
    const [unit, setUnit] = useState("");
    const [to, setTo] = useState("");
    const [busy, setBusy] = useState(false);

    const download = async () => {
        setBusy(true);
        try {
            await apiDownload(
                `/api/tprm/vendors/${tenantId}/intake-template?unit=${encodeURIComponent(unit)}`,
                "Supplier_Intake_Template.xlsx");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const email = async () => {
        setBusy(true);
        try {
            const r = await apiPost(`/api/tprm/vendors/${tenantId}/intake-template/email`,
                { to, businessUnit: unit });
            tprmAlert.success("Queued", r.message);
            setTo("");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    return (
        <div className="tprm-grid k2">
            <div className="tprm-card">
                <div className="tprm-card-title" style={{ marginBottom: 14 }}>SEND THE TEMPLATE</div>
                <div className="tprm-note" style={{ marginBottom: 16 }}>
                    This workbook asks who the client's suppliers are and what they do. It contains
                    no security questions at all. Those come later, and go to the suppliers rather
                    than to the client.
                </div>
                <div className="tprm-field">
                    <label>Business unit (optional)</label>
                    <input
                        className="tprm-input" value={unit}
                        placeholder="Upstream Operations"
                        onChange={e => setUnit(e.target.value)}
                    />
                    <div className="tprm-hint">
                        Only a label on the file. Useful when a large client sends several lists.
                    </div>
                </div>
                <button className="tprm-btn primary" onClick={download} disabled={busy}>
                    Download the template
                </button>
            </div>

            <div className="tprm-card">
                <div className="tprm-card-title" style={{ marginBottom: 14 }}>OR EMAIL IT DIRECTLY</div>
                <div className="tprm-field">
                    <label>Send to</label>
                    <input
                        className="tprm-input" type="email" value={to}
                        placeholder="procurement.head@client.com"
                        onChange={e => setTo(e.target.value)}
                    />
                    <div className="tprm-hint">
                        Usually the client's procurement or contracts lead. They are the only person
                        who can produce the supplier master.
                    </div>
                </div>
                <button
                    className="tprm-btn navy" onClick={email}
                    disabled={busy || !to}
                >
                    Email the template
                </button>
                <div className="tprm-hint" style={{ marginTop: 12 }}>
                    Mail is queued in the outbox first, so nothing is lost if the mail provider is
                    briefly unavailable.
                </div>
            </div>
        </div>
    );
}

/* ============================================ 2. upload and preview */
function StepUpload({ tenantId, onChanged, goto }) {
    const fileRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [showRejected, setShowRejected] = useState(true);

    const upload = async (file) => {
        if (!file) return;
        setBusy(true); setPreview(null);
        try {
            const r = await apiUpload(`/api/tprm/vendors/${tenantId}/intake/preview`, file);
            setPreview(r);
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const commit = async () => {
        setBusy(true);
        try {
            const r = await apiPost(`/api/tprm/vendors/intake/${preview.batchId}/commit`, {});
            tprmAlert.success(`${r.imported} suppliers imported`);
            setPreview(null);
            if (fileRef.current) fileRef.current.value = "";
            onChanged();
            goto("classify");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const rows = preview ? preview.rows : [];
    const shown = showRejected ? rows : rows.filter(r => !r.errors.length);

    return (
        <>
            <div className="tprm-card" style={{ marginBottom: 18 }}>
                <div className="tprm-card-title" style={{ marginBottom: 14 }}>UPLOAD THE COMPLETED LIST</div>
                <div className="tprm-note" style={{ marginBottom: 16 }}>
                    Nothing is written to the register until you press Commit. Everything you see
                    below is a preview, and the rejected rows can be sent back to the client as a
                    precise fix list.
                </div>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx"
                    className="tprm-input"
                    onChange={e => upload(e.target.files[0])}
                    disabled={busy}
                />
            </div>

            {busy && <div className="tprm-loading">Reading the workbook...</div>}

            {preview && (
                <>
                    <div className="tprm-grid k4" style={{ marginBottom: 18 }}>
                        {[
                            ["Rows read", preview.summary.read, "var(--tprm-navy)"],
                            ["Valid", preview.summary.valid, "var(--tprm-green)"],
                            ["Rejected", preview.summary.rejected, "var(--tprm-red)"],
                            ["Unmapped columns", preview.unmappedColumns.length, "var(--tprm-muted)"],
                        ].map(x => (
                            <div className="tprm-card tprm-kpi" key={x[0]} style={{ borderTopColor: x[2] }}>
                                <div className="tprm-kpi-label">{x[0]}</div>
                                <div className="tprm-kpi-value" style={{ color: x[2] }}>{x[1]}</div>
                            </div>
                        ))}
                    </div>

                    <div className="tprm-page-actions" style={{ marginBottom: 14, marginLeft: 0 }}>
                        <button
                            className="tprm-btn primary" onClick={commit}
                            disabled={busy || preview.summary.valid === 0}
                        >
                            Commit {preview.summary.valid} valid rows
                        </button>
                        {preview.summary.rejected > 0 && (
                            <a
                                className="tprm-btn"
                                href={`${API_BASE}/api/tprm/vendors/intake/${preview.batchId}/errors.csv`}
                                target="_blank" rel="noreferrer"
                            >
                                Download the error list as CSV
                            </a>
                        )}
                        <button className="tprm-btn" onClick={() => setShowRejected(s => !s)}>
                            {showRejected ? "Hide rejected rows" : "Show rejected rows"}
                        </button>
                    </div>

                    <div className="tprm-card flush">
                        <table className="tprm-table">
                            <thead>
                                <tr>
                                    <th>Row</th><th>Supplier</th><th>Service</th>
                                    <th>Suggested instrument</th><th>Confidence</th><th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shown.slice(0, 500).map(r => (
                                    <tr key={r.rowNo} className={r.errors.length ? "danger" : ""}>
                                        <td className="num">{r.rowNo}</td>
                                        <td style={{ fontWeight: 600 }}>{r.vendorName || <i>blank</i>}</td>
                                        <td style={{ color: "var(--tprm-muted)", maxWidth: 300 }}>
                                            {r.serviceDesc}
                                        </td>
                                        <td>{r.suggestedSector || <i>no match</i>}</td>
                                        <td className="num">
                                            {r.confidence
                                                ? <span className={"tprm-chip " + (
                                                    r.confidence >= 80 ? "green"
                                                        : r.confidence >= 65 ? "amber" : "grey")}>
                                                    {r.confidence}%
                                                </span>
                                                : "-"}
                                        </td>
                                        <td>
                                            {r.errors.length
                                                ? <span style={{ color: "var(--tprm-red)", fontSize: 12 }}>
                                                    {r.errors.map(e => e.message).join("; ")}
                                                </span>
                                                : <span className="tprm-chip green">OK</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {shown.length > 500 && (
                            <div className="tprm-hint" style={{ padding: 14 }}>
                                Showing the first 500 of {shown.length} rows. All of them will be committed.
                            </div>
                        )}
                    </div>
                </>
            )}
        </>
    );
}

/* ================================================ 3. classification */
function StepClassify({ tenantId, onChanged }) {
    const [rows, setRows] = useState(null);
    const [sectors, setSectors] = useState([]);

    const load = useCallback(() => {
        apiJson(`/api/tprm/vendors/${tenantId}/classification`).then(setRows).catch(() => setRows([]));
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { apiJson("/api/tprm/library/sectors").then(setSectors).catch(() => {}); }, []);

    const change = async (id, sectorCode) => {
        try {
            await apiPut(`/api/tprm/vendors/third-parties/${id}/sector`, { sectorCode });
            load(); onChanged();
        } catch (e) { tprmAlert.apiError(e); }
    };

    if (!rows) return <div className="tprm-loading">Loading...</div>;

    return (
        <>
            <div className="tprm-note" style={{ marginBottom: 16 }}>
                Sorted worst confidence first, so you review only what the rules were unsure about.
                Anything above 80% is usually safe to leave alone.
            </div>
            <div className="tprm-card flush">
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Ref</th><th>Supplier</th><th>Service</th>
                            <th>Confidence</th><th style={{ width: 240 }}>Instrument</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.third_party_id}>
                                <td className="num">{r.ref_code}</td>
                                <td style={{ fontWeight: 600 }}>{r.third_party_name}</td>
                                <td style={{ color: "var(--tprm-muted)", maxWidth: 320 }}>{r.service_desc}</td>
                                <td>
                                    {r.confidence
                                        ? <span className={"tprm-chip " + (
                                            r.confidence >= 80 ? "green"
                                                : r.confidence >= 65 ? "amber" : "red")}>
                                            {r.confidence}%
                                        </span>
                                        : <span className="tprm-chip grey">manual</span>}
                                </td>
                                <td>
                                    <select
                                        className="tprm-select"
                                        value={r.sector_code}
                                        onChange={e => change(r.third_party_id, e.target.value)}
                                    >
                                        {sectors.map(s => (
                                            <option key={s.sector_code} value={s.sector_code}>
                                                {s.sector_name}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={5} className="tprm-empty">
                                No suppliers yet. Upload an intake list first.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

/* ======================================================= 4. triage */
function StepTriage({ tenantId, onChanged }) {
    const [rows, setRows] = useState(null);

    const load = useCallback(() => {
        apiJson(`/api/tprm/vendors/${tenantId}/triage`).then(setRows).catch(() => setRows([]));
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    const decide = async (r, inScope) => {
        let reason = null;
        if (!inScope) {
            reason = await tprmAlert.reason(
                `Descope ${r.third_party_name}?`,
                "Why is this supplier out of scope? This is the decision an auditor questions first.",
                10);
            if (!reason) return;
        }
        try {
            await apiPost(`/api/tprm/vendors/third-parties/${r.third_party_id}/triage`, { inScope, reason });
            load(); onChanged();
        } catch (e) { tprmAlert.apiError(e); }
    };

    if (!rows) return <div className="tprm-loading">Loading...</div>;

    const undecided = rows.filter(r => r.in_scope === null).length;

    return (
        <>
            <div className="tprm-note" style={{ marginBottom: 16 }}>
                {undecided > 0
                    ? `${undecided} suppliers still need a decision. `
                    : "Every supplier has a triage decision. "}
                Suppliers that reported no data access and no system connection on the intake sheet
                were descoped automatically. Confirm or overturn each one.
            </div>
            <div className="tprm-card flush">
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Ref</th><th>Supplier</th><th>Data</th><th>Systems</th>
                            <th>Decision</th><th>Reason</th><th style={{ width: 170 }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.third_party_id}>
                                <td className="num">{r.ref_code}</td>
                                <td style={{ fontWeight: 600 }}>{r.third_party_name}</td>
                                <td>{r.data_access || "-"}</td>
                                <td>{r.system_access || "-"}</td>
                                <td>
                                    {r.in_scope === null
                                        ? <span className="tprm-chip grey">Not decided</span>
                                        : Number(r.in_scope) === 1
                                            ? <span className="tprm-chip green">In scope</span>
                                            : <span className="tprm-chip grey">Out of scope</span>}
                                </td>
                                <td style={{ color: "var(--tprm-muted)", fontSize: 12, maxWidth: 260 }}>
                                    {r.reason}
                                </td>
                                <td>
                                    <button
                                        className="tprm-btn sm"
                                        style={{ marginRight: 6 }}
                                        onClick={() => decide(r, true)}
                                    >
                                        In scope
                                    </button>
                                    <button className="tprm-btn sm" onClick={() => decide(r, false)}>
                                        Descope
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={7} className="tprm-empty">No suppliers yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

/* ====================================================== 5. tiering */
function StepTiering({ tenantId, onChanged, goto }) {
    const fileRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    const download = async () => {
        setBusy(true);
        try {
            await apiDownload(`/api/tprm/distribution/${tenantId}/tiering-pack`, "Tiering_Pack.xlsx");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const importPack = async (file) => {
        if (!file) return;
        setBusy(true); setResult(null);
        try {
            const r = await apiUpload(`/api/tprm/distribution/${tenantId}/tiering-pack/import`, file);
            setResult(r);
            onChanged();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    return (
        <>
            <div className="tprm-note" style={{ marginBottom: 18 }}>
                These twelve questions are about the client's <b>relationship</b> with each supplier,
                not about the supplier's own controls. Only the client can answer them, which is why
                this is a separate file from the questionnaire the supplier receives.
            </div>

            <div className="tprm-grid k2">
                <div className="tprm-card">
                    <div className="tprm-card-title" style={{ marginBottom: 14 }}>1. SEND THE PACK</div>
                    <p style={{ fontSize: 13, color: "var(--tprm-muted)", lineHeight: 1.6 }}>
                        One workbook, one row per in-scope supplier, twelve columns of 1 to 3.
                        The Questions sheet explains what each score means.
                    </p>
                    <button className="tprm-btn primary" onClick={download} disabled={busy}>
                        Download the tiering pack
                    </button>
                </div>

                <div className="tprm-card">
                    <div className="tprm-card-title" style={{ marginBottom: 14 }}>2. READ IT BACK</div>
                    <p style={{ fontSize: 13, color: "var(--tprm-muted)", lineHeight: 1.6 }}>
                        Every supplier gets an inherent score, a tier, and an open assessment,
                        in one pass.
                    </p>
                    <input
                        ref={fileRef} type="file" accept=".xlsx" className="tprm-input"
                        onChange={e => importPack(e.target.files[0])} disabled={busy}
                    />
                </div>
            </div>

            {busy && <div className="tprm-loading">Working...</div>}

            {result && (
                <div className="tprm-card flush" style={{ marginTop: 18 }}>
                    <div className="tprm-card-head">
                        <div className="tprm-card-title">{result.tiered} SUPPLIERS TIERED</div>
                        <div style={{ marginLeft: "auto" }}>
                            <button className="tprm-btn sm" onClick={() => goto("distribute")}>
                                Go to distribution
                            </button>
                        </div>
                    </div>
                    <table className="tprm-table">
                        <thead>
                            <tr><th>Supplier</th><th>Answered</th><th>Inherent</th><th>Tier</th><th>Status</th></tr>
                        </thead>
                        <tbody>
                            {result.results.map((r, i) => (
                                <tr key={i}>
                                    <td style={{ fontWeight: 600 }}>{r.supplier}</td>
                                    <td className="num">
                                        {r.answered != null ? `${r.answered} of ${r.expected}` : "-"}
                                        {r.partial && (
                                            <span className="tprm-chip amber" style={{ marginLeft: 6 }}>partial</span>
                                        )}
                                    </td>
                                    <td className="num">{r.inherent ?? "-"}</td>
                                    <td>
                                        {r.tier
                                            ? <span className={"tprm-chip " + (
                                                r.tier === 1 ? "red" : r.tier === 2 ? "amber" : "green")}>
                                                TIER {r.tier}
                                            </span>
                                            : "-"}
                                    </td>
                                    <td style={{ fontSize: 12, color: "var(--tprm-muted)" }}>
                                        {r.status === "tiered" ? "Tiered" : r.message}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {result.problems.length > 0 && (
                        <div style={{ padding: 14 }}>
                            <div className="tprm-note warn">
                                {result.problems.length} cells could not be read:
                                {" "}{result.problems.slice(0, 5).map(p => `row ${p.row} ${p.ref}`).join(", ")}
                                {result.problems.length > 5 ? "..." : ""}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

/* ================================================= 6. distribution */
function StepDistribute({ tenantId, onChanged }) {
    const [rows, setRows] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        apiJson(`/api/tprm/distribution/${tenantId}/status`).then(setRows).catch(() => setRows([]));
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    const zip = async () => {
        setBusy(true);
        try {
            await apiDownload(`/api/tprm/distribution/${tenantId}/issue-zip`, "questionnaires.zip");
            load(); onChanged();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const emailAll = async () => {
        const ok = await tprmAlert.confirm(
            "Email every outstanding questionnaire?",
            "Each supplier receives its own workbook, attached. Suppliers with no security contact on file are skipped.",
            "Yes, send them");
        if (!ok) return;
        setBusy(true);
        try {
            const r = await apiPost(`/api/tprm/distribution/${tenantId}/issue-email`, {});
            tprmAlert.success(`${r.sent} questionnaires queued`,
                r.skipped.length ? `${r.skipped.length} skipped for having no contact email.` : "");
            load(); onChanged();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const remind = async (a) => {
        try {
            await apiPost(`/api/tprm/distribution/assessments/${a.assessment_id}/remind`, {});
            tprmAlert.success("Reminder queued");
            load();
        } catch (e) { tprmAlert.apiError(e); }
    };

    if (!rows) return <div className="tprm-loading">Loading...</div>;

    return (
        <>
            <div className="tprm-note" style={{ marginBottom: 16 }}>
                Two routes, and they are not equivalent. The ZIP hands the whole set to the client to
                forward, which keeps us out of the supplier relationship. Emailing direct is faster
                but means we are chasing suppliers ourselves.
            </div>

            <div className="tprm-page-actions" style={{ marginLeft: 0, marginBottom: 16 }}>
                <button className="tprm-btn primary" onClick={zip} disabled={busy}>
                    Download all as ZIP
                </button>
                <button className="tprm-btn navy" onClick={emailAll} disabled={busy}>
                    Email each supplier directly
                </button>
            </div>

            <div className="tprm-card flush">
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Ref</th><th>Supplier</th><th>Tier</th><th>Contact</th>
                            <th>Channel</th><th>State</th><th>Issued</th><th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.assessment_id}>
                                <td className="num">{r.ref_code}</td>
                                <td style={{ fontWeight: 600 }}>{r.third_party_name}</td>
                                <td>
                                    <span className={"tprm-chip " + (
                                        r.tier === 1 ? "red" : r.tier === 2 ? "amber" : "green")}>
                                        TIER {r.tier}
                                    </span>
                                </td>
                                <td style={{ fontSize: 12, color: "var(--tprm-muted)" }}>
                                    {r.security_contact || <i>none on file</i>}
                                </td>
                                <td>{r.channel || "-"}</td>
                                <td>
                                    <span className={"tprm-chip " + (
                                        r.state === "imported" ? "green"
                                            : r.state ? "blue" : "grey")}>
                                        {r.state || "not issued"}
                                    </span>
                                </td>
                                <td style={{ fontSize: 12 }}>
                                    {r.issued_time ? String(r.issued_time).slice(0, 10) : "-"}
                                </td>
                                <td>
                                    {r.recipient && r.state !== "imported" && (
                                        <button className="tprm-btn sm" onClick={() => remind(r)}>
                                            Remind
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={8} className="tprm-empty">
                                Nothing is tiered yet. Complete the Tiering step first.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

/* ============================================ 7. import responses */
function StepImport({ onChanged }) {
    const fileRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const [pendingFile, setPendingFile] = useState(null);
    const [busy, setBusy] = useState(false);

    const doPreview = async (file) => {
        if (!file) return;
        setBusy(true); setPreview(null); setPendingFile(file);
        try {
            const r = await apiUpload("/api/tprm/distribution/import/preview", file);
            setPreview(r);
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const commit = async () => {
        setBusy(true);
        try {
            const r = await apiUpload("/api/tprm/distribution/import/commit", pendingFile);
            tprmAlert.success(
                `${r.imported} answers imported`,
                `${r.vendorAsserted} await your acceptance. ${r.autoNotEvidenced} dropped to `
                + `Not Evidenced automatically for having no evidence attached.`);
            setPreview(null); setPendingFile(null);
            if (fileRef.current) fileRef.current.value = "";
            onChanged();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    return (
        <>
            <div className="tprm-note" style={{ marginBottom: 16 }}>
                Drop in one returned workbook, or a ZIP containing several plus their evidence
                files. Each workbook carries a hidden identity marker, so nothing has to be matched
                by hand. Put evidence in a folder named after the control reference, or name the
                file with that prefix, for example <code>IAM-02_mfa_policy.pdf</code>.
            </div>

            <div className="tprm-card" style={{ marginBottom: 18 }}>
                <input
                    ref={fileRef} type="file" accept=".xlsx,.zip" className="tprm-input"
                    onChange={e => doPreview(e.target.files[0])} disabled={busy}
                />
            </div>

            {busy && <div className="tprm-loading">Reading...</div>}

            {preview && (
                <>
                    <div className="tprm-page-actions" style={{ marginLeft: 0, marginBottom: 14 }}>
                        <button
                            className="tprm-btn primary" onClick={commit}
                            disabled={busy || !preview.results.some(r => r.status === "ready")}
                        >
                            Import these responses
                        </button>
                    </div>
                    <div className="tprm-card flush">
                        <table className="tprm-table">
                            <thead>
                                <tr>
                                    <th>File</th><th>Supplier</th><th>Will import</th>
                                    <th>With evidence</th><th>Will drop</th><th>Problems</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.results.map((r, i) => (
                                    <tr key={i} className={r.status === "skipped" ? "danger" : ""}>
                                        <td style={{ fontSize: 12 }}>{r.file}</td>
                                        <td style={{ fontWeight: 600 }}>{r.supplier || "-"}</td>
                                        <td className="num">{r.willImport ?? "-"}</td>
                                        <td className="num">{r.withEvidence ?? "-"}</td>
                                        <td className="num">
                                            {r.willDropToNotEvidenced != null && (
                                                <span className={"tprm-chip " + (
                                                    r.willDropToNotEvidenced > 0 ? "amber" : "green")}>
                                                    {r.willDropToNotEvidenced}
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ fontSize: 12, color: "var(--tprm-muted)" }}>
                                            {r.status === "skipped"
                                                ? r.message
                                                : (r.cannotMatch && r.cannotMatch.length
                                                    ? `${r.cannotMatch.length} rows could not be read`
                                                    : "none")}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="tprm-note warn" style={{ marginTop: 14 }}>
                        Anything in the "will drop" column was answered by the supplier but has no
                        evidence attached. Those controls are recorded as Not Evidenced and score 1.
                        The original claim is kept in the assessor note so you can still read it.
                    </div>
                </>
            )}
        </>
    );
}

export default TPRMVendorPopulation;
