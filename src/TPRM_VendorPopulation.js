import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { apiJson, apiPost, apiPut, apiUpload, apiDownload, API_BASE } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import { FaRegEnvelopeOpen, FaPaperPlane } from "react-icons/fa";
import TPRMMailPreview from "./TPRM_MailPreview";
import "./TPRM_VendorPopulation.css";
import TPRMSelect from "./TPRM_Select";
import TPRMClientBar from "./TPRM_ClientBar";

// What each step of the pipeline is called, and what the heading over it says.
// The rail that moves between the steps lives in the client bar, because the
// bar is what names the engagement they all belong to.
//
// Each step is reachable directly rather than being a locked wizard, because
// real engagements loop back: a supplier list arrives in three parts and
// triage restarts while classification is still being reviewed.
const STEP_HEADS = {
    template: ["Intake template",
        "Send this to the client. They export their supplier master into it, usually in one pass."],
    upload: ["Upload vendor list",
        "Excel or CSV. Column headings do not have to match ours, we map them."],
    classify: ["Classification review",
        "The rules have suggested an instrument for every supplier. Confirm, or correct the ones that matter."],
    triage: ["Triage, scope decision",
        "Descope the noise before anyone is asked a hundred questions."],
    tiering: ["Tiering",
        "Only the client can answer these. They describe the relationship, not the supplier own controls."],
    distribute: ["Issue and track",
        "Both delivery routes stay available, and every supplier carries an owner."],
    import: ["Import returned pack",
        "Drop the whole ZIP the client sends back. Every workbook inside is read and reported separately."],
};

function TPRMVendorPopulation() {
    const { tenantId, tenant } = useAccess();
    // The step lives in the URL rather than in state, so the Vendor Population
    // tab in the client bar can get back here from inside a step: it navigates
    // to the bare route, and the query drops off with it.
    const [params, setParams] = useSearchParams();
    // An unknown step is the overview rather than a blank screen: the query
    // is user editable, and a hand typed ?step=classifed should not white out.
    const asked = params.get("step");
    const step = asked && STEP_HEADS[asked] ? asked : "overview";
    const [funnel, setFunnel] = useState(null);

    const goto = useCallback((key) => {
        if (!key || key === "overview") setParams({});
        else setParams({ step: key });
        window.scrollTo(0, 0);
    }, [setParams]);

    const loadFunnel = useCallback(() => {
        if (!tenantId) return;
        apiJson(`/api/tprm/vendors/${tenantId}/funnel`).then(setFunnel).catch(() => {});
    }, [tenantId]);

    useEffect(() => { loadFunnel(); }, [loadFunnel, step]);

    const Body = {
        template: StepTemplate, upload: StepUpload, classify: StepClassify,
        triage: StepTriage, tiering: StepTiering, distribute: StepDistribute,
        import: StepImport,
    }[step];
    const head = STEP_HEADS[step];

    return (
        <div className="tprm-page">
            {/* The bar names the client every screen below is scoped to, and
                carries the rail once you are inside a step. On the overview
                there is no rail: the funnel is the navigation there. */}
            <TPRMClientBar
                active="pop"
                sub={step === "overview" ? null : step}
                onStep={goto}
            />

            {!tenantId ? (
                <div className="tprm-note warn">Select a client first.</div>
            ) : step === "overview" ? (
                funnel
                    ? <Overview funnel={funnel} tenant={tenant} goto={goto} />
                    : <div className="tprm-loading">Working out where the population is...</div>
            ) : (
                <>
                    <div className="tprm-page-head">
                        <div>
                            <h1 className="tprm-page-title">{head ? head[0] : "Vendor population"}</h1>
                            {head && <div className="tprm-page-sub">{head[1]}</div>}
                        </div>
                    </div>
                    <Body tenantId={tenantId} tenant={tenant} onChanged={loadFunnel} goto={goto} />
                </>
            )}
        </div>
    );
}

/* ------------------------------------------------------------- overview */

/* The funnel. Nobody assesses the whole register, and nobody should - so the
   shape of the narrowing is the first thing this screen says. Bars are scaled
   against the population received, which is the only honest denominator.

   Five stages, and each one is a filter rather than a queue: a supplier does
   not leave a stage, it accumulates into the next. */
const FUNNEL_STAGES = [
    ["Population received", "received", "var(--tprm-ink)", "#fff",
        "Full supplier list uploaded from the client procurement export"],
    ["Classified", "classified", "var(--tprm-blue)", "#fff",
        "Instrument suggested by rule, confirmed by an assessor"],
    ["In scope after triage", "in_scope", "var(--tprm-purple)", "#fff",
        "Descoped: no data, no access, one-off purchases below threshold"],
    ["Tiered", "tiered", "var(--tprm-amber)", "#fff",
        "Inherent tiering complete, Tier 1 and 2 proceed to assessment"],
    ["Assessed", "assessed", "var(--tprm-green)", "#fff",
        "Control assessment issued, returned and scored"],
];

/* Where to go next, for someone who has just read the funnel and can see which
   stage is starving. Each card carries its own live backlog, so the number is
   the reason to open it rather than decoration. */
const OVERVIEW_ACTIONS = [
    ["Classify", "awaiting_classify", "suppliers need a category confirmed",
        "classify", "var(--tprm-blue)"],
    ["Triage", "awaiting_triage", "suppliers awaiting a scope decision",
        "triage", "var(--tprm-purple)"],
    ["Issue", "awaiting_issue", "tiered suppliers ready for a questionnaire",
        "distribute", "var(--tprm-amber)"],
    ["Import", "awaiting_import", "returned packs waiting to be read in",
        "import", "var(--tprm-green)"],
];

function Overview({ funnel, tenant, goto }) {
    const received = Number(funnel.received) || 0;
    const assessed = Number(funnel.assessed) || 0;
    // Never divide by the count of an empty register. An untouched client
    // should show five empty tracks, not five full ones.
    const max = Math.max(1, received);

    return (
        <>
            <div className="tprm-page-head">
                <div>
                    <h1 className="tprm-page-title">Vendor population</h1>
                    <div className="tprm-page-sub">
                        {tenant ? tenant.tenant_name + ". " : ""}
                        {received} supplier{received === 1 ? "" : "s"} received,
                        {" "}{assessed} fully assessed.
                    </div>
                </div>
                <div className="tprm-page-actions">
                    <button className="tprm-btn" onClick={() => goto("template")}>
                        Intake template
                    </button>
                    <button className="tprm-btn gold" onClick={() => goto("upload")}>
                        Upload vendor list
                    </button>
                </div>
            </div>

            <div className="tprm-card" style={{ marginBottom: 18 }}>
                <div className="tprm-card-title" style={{ marginBottom: 6 }}>
                    The funnel. Nobody assesses the whole register, and nobody should
                </div>
                {FUNNEL_STAGES.map(([label, key, fill, ink, why]) => {
                    const n = Number(funnel[key]) || 0;
                    return (
                        <div className="tprm-funnel-row" key={key}>
                            <div className="tprm-funnel-label">{label}</div>
                            <div className="tprm-funnel-track">
                                <div
                                    className="tprm-funnel-fill"
                                    style={{ width: (n / max * 100) + "%", background: fill, color: ink }}
                                >
                                    <span>{n}</span>
                                </div>
                            </div>
                            <div className="tprm-funnel-why">{why}</div>
                        </div>
                    );
                })}
            </div>

            <div className="tprm-grid k4">
                {OVERVIEW_ACTIONS.map(([title, key, why, target, colour]) => {
                    const n = Number(funnel[key]) || 0;
                    return (
                        <div className="tprm-card tprm-kpi" key={target}
                            style={{ borderTopColor: colour }}>
                            <div className="tprm-pop-actiontitle">{title}</div>
                            <div className="tprm-kpi-sub tprm-pop-actionwhy">
                                <b style={{ color: colour }}>{n}</b> {why}
                            </div>
                            <button className="tprm-btn primary sm" onClick={() => goto(target)}>
                                Open
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="tprm-note blue" style={{ marginTop: 18 }}>
                A single add form exists for one-off suppliers, but it is never the main
                path. At a hundred and fifty suppliers it would take a day of typing and
                the sector would be guessed. The pipeline above is the main path, and the
                classification is suggested rather than typed.
            </div>
        </>
    );
}

/* =============================================== 1. the intake template */

/* What the client is being asked for, column by column. This is the substance
   of the step: the workbook comes back useless if the wrong columns are filled,
   and the only defence is saying plainly which ones matter and why. */
const INTAKE_COLUMNS = [
    ["Supplier legal name", "Required", "red", "As it appears on the contract"],
    ["Trading name", "Optional", "grey", "If different from the legal name"],
    ["Service description", "Required", "red", "One line. This drives the category suggestion"],
    ["Your spend category", "Recommended", "amber", "Straight from the procurement system"],
    ["Annual contract value", "Recommended", "amber", "Used for materiality, not tiering alone"],
    ["Contract owner", "Required", "red", "Who owns the relationship internally"],
    ["Supplier contact email", "Required", "red", "Where the questionnaire will be sent"],
    ["Accesses our data", "Required", "red", "Y or N. Drives the triage decision"],
    ["Connects to our systems", "Required", "red", "Y or N. Drives the triage decision"],
    ["Category", "Leave blank", "grey", "We suggest it, an assessor confirms it"],
];

function StepTemplate({ tenantId, tenant, goto }) {
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
        <div className="tprm-intake">
            <div className="tprm-card flush">
                <div className="tprm-intake-head">
                    <div className="tprm-card-title">Columns in the workbook</div>
                </div>
                <table className="tprm-table">
                    <tbody>
                        {INTAKE_COLUMNS.map(([name, need, tone, why]) => (
                            <tr key={name}>
                                <td style={{ width: 220, fontWeight: 600 }}>{name}</td>
                                <td style={{ width: 140 }}>
                                    <span className={"tprm-chip " + tone}>{need}</span>
                                </td>
                                <td style={{ color: "var(--tprm-muted)", fontSize: 13.5 }}>{why}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="tprm-intake-actions">
                    <button className="tprm-btn gold" onClick={download} disabled={busy}>
                        Download the template
                    </button>
                    <button className="tprm-btn primary" onClick={() => goto("upload")}>
                        I have the completed list
                    </button>
                </div>
            </div>

            <div>
                <div className="tprm-card" style={{ marginBottom: 16 }}>
                    <div className="tprm-card-title" style={{ marginBottom: 14 }}>
                        Email it to a business unit
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
                    <div className="tprm-field">
                        <label>Send to</label>
                        <input
                            className="tprm-input" type="email" value={to}
                            placeholder="procurement.head@client.com"
                            onChange={e => setTo(e.target.value)}
                        />
                        <div className="tprm-hint">
                            Usually the client procurement or contracts lead. They are the only
                            person who can produce the supplier master.
                        </div>
                    </div>
                    <button
                        className="tprm-btn primary wide" onClick={email}
                        disabled={busy || !to}
                    >
                        Send template
                    </button>
                    <div className="tprm-hint" style={{ marginTop: 12 }}>
                        Mail is queued in the outbox first, so nothing is lost if the mail provider
                        is briefly unavailable.
                    </div>
                </div>
                <div className="tprm-note">
                    The Category column is deliberately blank. Asking a procurement officer to pick
                    from 36 cyber instruments produces worse data than letting the rules suggest it.
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
                {/* A bare file input gives no target to drag onto and no idea
                    what the file should be. The zone says both. */}
                <div className="tprm-dropzone">
                    <div className="tprm-dropzone-title">Drop the completed workbook here</div>
                    <div className="tprm-dropzone-sub">
                        xlsx or xls, up to 25,000 rows in one upload
                    </div>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".xlsx,.xls"
                        style={{ display: "none" }}
                        onChange={e => upload(e.target.files[0])}
                        disabled={busy}
                    />
                    <button
                        className="tprm-btn primary"
                        onClick={() => fileRef.current && fileRef.current.click()}
                        disabled={busy}
                    >
                        {busy ? "Reading..." : "Choose file"}
                    </button>
                </div>
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
                            className="tprm-btn gold" onClick={commit}
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

/* The four numbers this step opens on. The last one is the only one that moves
   as you work: it is the size of the job still in front of you. */
const CLASSIFY_CARDS = [
    ["high", "Suggested with high confidence", "var(--tprm-green)"],
    ["low", "Low confidence, check these", "var(--tprm-amber)"],
    ["none", "No suggestion, needs a category", "var(--tprm-red)"],
    ["awaiting", "Still awaiting confirmation", "var(--tprm-blue)"],
];

function StepClassify({ tenantId, onChanged, goto }) {
    const [d, setD] = useState(null);
    const [sectors, setSectors] = useState([]);
    const [rules, setRules] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        apiJson(`/api/tprm/vendors/${tenantId}/classification`)
            .then(setD).catch(() => setD({ rows: [], summary: {} }));
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        apiJson("/api/tprm/library/sectors").then(setSectors).catch(() => {});
        // Reading the rule table needs instrument.author, which an Engagement
        // Manager does not hold. Rather than show an empty card to half the
        // people who use this screen, the card is dropped when it 403s.
        apiJson("/api/tprm/library/classify-rules").then(setRules).catch(() => setRules([]));
    }, []);

    const change = async (id, sectorCode) => {
        try {
            await apiPut(`/api/tprm/vendors/third-parties/${id}/sector`, { sectorCode });
            load(); onChanged();
        } catch (e) { tprmAlert.apiError(e); }
    };

    const confirmOne = async (id) => {
        try {
            await apiPost(`/api/tprm/vendors/third-parties/${id}/confirm-sector`, {});
            load(); onChanged();
        } catch (e) { tprmAlert.apiError(e); }
    };

    const acceptAll = async () => {
        setBusy(true);
        try {
            const r = await apiPost(`/api/tprm/vendors/${tenantId}/classification/accept-all`, {});
            load(); onChanged();
            tprmAlert.success(r.confirmed
                ? `${r.confirmed} ${r.confirmed === 1 ? "supplier" : "suppliers"} confirmed`
                : "Nothing left to accept");
        } catch (e) {
            tprmAlert.apiError(e);
        } finally {
            setBusy(false);
        }
    };

    // The endpoint returns one row per keyword. A person reads them per
    // instrument, which is how the rule is actually written.
    const ruleGroups = [];
    for (const r of rules || []) {
        let g = ruleGroups.find(x => x.code === r.sector_code);
        if (!g) ruleGroups.push(g = {
            code: r.sector_code, name: r.sector_name || r.sector_code, keywords: [],
        });
        g.keywords.push(r.keyword);
    }

    if (!d) return <div className="tprm-loading">Loading...</div>;

    const { rows, summary } = d;
    // Everything the rules classified has already been agreed with, so the bulk
    // action has nothing left to do.
    const nothingToAccept = rows.every(r => r.sector_confirmed_time || !r.sector_code);

    return (
        <>
            <div className="tprm-step-actions">
                <button className="tprm-btn" onClick={acceptAll} disabled={busy || nothingToAccept}>
                    {busy ? "Accepting..." : "Accept all suggestions"}
                </button>
                <button className="tprm-btn gold" onClick={() => goto("triage")}>
                    Continue to triage
                </button>
            </div>

            <div className="tprm-cls-cards">
                {CLASSIFY_CARDS.map(([key, label, colour]) => (
                    <div className="tprm-card tprm-cls-card" key={key} style={{ borderTopColor: colour }}>
                        <div className="tprm-cls-n" style={{ color: colour }}>{summary[key] ?? 0}</div>
                        <div className="tprm-cls-l">{label}</div>
                    </div>
                ))}
            </div>

            <div className="tprm-note" style={{ marginBottom: 16 }}>
                Unconfirmed first, worst confidence first within that, so you review only what the
                rules were unsure about. Anything above 90% is usually safe to accept.
            </div>

            <div className="tprm-card flush">
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Ref</th><th>Supplier</th><th>Service line</th>
                            <th>Their spend category</th>
                            <th style={{ width: 240 }}>Instrument</th><th>Confidence</th><th />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            /* Anything still unconfirmed is tinted, so a long
                               register shows its own review queue. */
                            <tr key={r.third_party_id}
                                className={r.sector_confirmed_time ? "" : "tprm-row-attention"}>
                                <td className="num">{r.ref_code}</td>
                                <td style={{ fontWeight: 600 }}>{r.third_party_name}</td>
                                <td style={{ color: "var(--tprm-muted)", maxWidth: 320 }}>{r.service_desc}</td>
                                <td>
                                    {r.spend_category
                                        ? <span className="tprm-chip grey">{r.spend_category}</span>
                                        : <span style={{ color: "var(--tprm-faint)" }}>-</span>}
                                </td>
                                <td>
                                    <TPRMSelect
                                        className={r.sector_code ? "" : "tprm-sel-required"}
                                        value={r.sector_code}
                                        onChange={v => change(r.third_party_id, v)}
                                        placeholder="Choose an instrument"
                                        ariaLabel={`Instrument for ${r.third_party_name}`}
                                        options={sectors.map(x => ({
                                            value: x.sector_code, label: x.sector_name,
                                        }))}
                                    />
                                </td>
                                {/* A bar reads as a quantity; a pill reads as a
                                    label. Confidence is a quantity, and the eye
                                    can sort a column of bars without reading. */}
                                <td>
                                    {!r.sector_code
                                        ? <span className="tprm-chip red">NO MATCH</span>
                                        : r.confidence
                                            ? (
                                                <div className="tprm-conf">
                                                    <div className="tprm-conf-track">
                                                        <div
                                                            className="tprm-conf-fill"
                                                            style={{
                                                                width: r.confidence + "%",
                                                                background: Number(r.confidence) >= 90
                                                                    ? "var(--tprm-green)"
                                                                    : "var(--tprm-amber)",
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="mono">{r.confidence}%</span>
                                                </div>
                                            )
                                            : <span className="tprm-chip grey">manual</span>}
                                </td>
                                {/* Confirmed is a state, not an action, so it stops
                                    being a button once it has happened. */}
                                <td>
                                    {r.sector_confirmed_time
                                        ? <span className="tprm-chip green">CONFIRMED</span>
                                        : (
                                            <button
                                                className="tprm-btn sm primary"
                                                disabled={!r.sector_code}
                                                title={r.sector_code ? undefined
                                                    : "Choose an instrument first"}
                                                onClick={() => confirmOne(r.third_party_id)}
                                            >
                                                Confirm
                                            </button>
                                        )}
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={7} className="tprm-empty">
                                No suppliers yet. The register is filled from the client's own
                                supplier list.
                                <div style={{ marginTop: 12, display: "flex", gap: 8,
                                    justifyContent: "center" }}>
                                    <button className="tprm-btn sm"
                                        onClick={() => goto("template")}>
                                        Send the intake template
                                    </button>
                                    <button className="tprm-btn primary sm"
                                        onClick={() => goto("upload")}>
                                        Upload a completed list
                                    </button>
                                </div>
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="tprm-cls-explain">
                <div className="tprm-card">
                    <div className="tprm-lab">How the suggestion is produced</div>
                    <p className="tprm-cls-prose">
                        Keyword rules run across the supplier name, the service line and the client's
                        own spend category, each mapping to one of the instruments in the library.
                        The rules live in a table, so a new one is added without a deployment.
                    </p>
                    <p className="tprm-cls-prose">
                        Confidence is the strength of the match. Anything under 90 is surfaced for a
                        human, and anything with no match blocks progress until a category is chosen.
                    </p>
                </div>
                {ruleGroups.length > 0 && (
                    <div className="tprm-card tprm-cls-rules">
                        <div className="tprm-lab">Example rules in force</div>
                        {ruleGroups.slice(0, 5).map(g => (
                            <div className="tprm-cls-rule" key={g.code}>
                                <div className="tprm-cls-rulename">{g.name}</div>
                                <div className="mono tprm-cls-rulekw">
                                    {g.keywords.slice(0, 5).join("  |  ")}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

/* ======================================================= 4. triage */
function StepTriage({ tenantId, onChanged, goto }) {
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
    const inScope = rows.filter(r => Number(r.in_scope) === 1).length;

    return (
        <>
            {/* The rule is stated before the decisions are taken, because this is
                the decision an auditor questions first and consistency across a
                register only happens if everyone is applying the same test. */}
            <div className="tprm-card" style={{ marginBottom: 18 }}>
                <div className="tprm-card-title" style={{ marginBottom: 10 }}>
                    The descope rule, editable per client
                </div>
                <div style={{ fontSize: 14.5, color: "var(--tprm-muted)", lineHeight: 1.8 }}>
                    A supplier is descoped when it touches <b>no client data</b>, has <b>no system
                    or network connectivity</b>, and sits <b>below the materiality threshold</b>.
                    Descoped does not mean forgotten: the record keeps its reason and an annual
                    re-check.
                </div>
            </div>
            <div className="tprm-note" style={{ marginBottom: 16 }}>
                {undecided > 0
                    ? `${undecided} suppliers still need a decision. `
                    : "Every supplier has a triage decision. "}
                Suppliers that reported no data access and no system connection on the intake sheet
                were descoped automatically. Confirm or overturn each one.
            </div>
            <div className="tprm-step-actions">
                <button className="tprm-btn gold" onClick={() => goto("tiering")}>
                    Continue to tiering, {inScope} in scope
                </button>
            </div>
            <div className="tprm-card flush">
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Ref</th><th>Supplier</th><th>Instrument</th>
                            <th>Data access</th><th>System access</th><th>Annual value</th>
                            <th>Decision</th><th>Reason</th><th>Scope decision</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.third_party_id}
                                className={Number(r.in_scope) === 0 ? "tprm-row-muted" : ""}>
                                <td className="num">{r.ref_code}</td>
                                <td style={{ fontWeight: 600 }}>{r.third_party_name}</td>
                                <td style={{ color: "var(--tprm-muted)", fontSize: 13 }}>
                                    {r.sector_code || "-"}
                                </td>
                                {/* Y and N as plain text read the same at a glance.
                                    Reach is the thing triage turns on, so it is
                                    coloured: red where the supplier can get in. */}
                                <td>
                                    <span className={"tprm-chip " + (r.data_access === "Y" ? "red" : "grey")}>
                                        {r.data_access || "-"}
                                    </span>
                                </td>
                                <td>
                                    <span className={"tprm-chip " + (r.system_access === "Y" ? "red" : "grey")}>
                                        {r.system_access || "-"}
                                    </span>
                                </td>
                                <td className="num">{r.annual_value || "-"}</td>
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
                                {/* The decision already taken is the filled one, so
                                    the current state is readable without going back
                                    to the Decision column. */}
                                <td>
                                    <div className="tprm-decide">
                                        <button
                                            className={"tprm-btn sm"
                                                + (Number(r.in_scope) === 1 ? " primary" : "")}
                                            onClick={() => decide(r, true)}
                                        >
                                            In scope
                                        </button>
                                        <button
                                            className={"tprm-btn sm"
                                                + (Number(r.in_scope) === 0 ? " danger" : "")}
                                            onClick={() => decide(r, false)}
                                        >
                                            Descope
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={9} className="tprm-empty">No suppliers yet.</td></tr>
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

            {/* Two routes, not two steps. They are alternatives - a pack for
                volume, a live session for anything likely to land Tier 1 - and
                numbering them 1 and 2 said the opposite. */}
            <div className="tprm-grid k2">
                <div className="tprm-card tprm-route" style={{ borderTopColor: "var(--tprm-blue)" }}>
                    <div className="tprm-route-title">Route A. Send a tiering pack</div>
                    <p className="tprm-route-why">
                        One workbook, one row per in-scope supplier, the twelve tiering questions
                        as locked dropdown columns. Best for volume.
                    </p>
                    <button className="tprm-btn primary" onClick={download} disabled={busy}>
                        Download tiering pack
                    </button>
                </div>

                <div className="tprm-card tprm-route" style={{ borderTopColor: "var(--tprm-purple)" }}>
                    <div className="tprm-route-title">Route B. Read a completed pack back</div>
                    <p className="tprm-route-why">
                        Every supplier gets an inherent score, a tier, and an open assessment, in
                        one pass. Best once the client has filled the pack in.
                    </p>
                    <input
                        ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }}
                        onChange={e => importPack(e.target.files[0])} disabled={busy}
                    />
                    <button
                        className="tprm-btn primary"
                        onClick={() => fileRef.current && fileRef.current.click()}
                        disabled={busy}
                    >
                        {busy ? "Reading..." : "Choose the completed pack"}
                    </button>
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
    // { ids?, previewOnly, reminder } - null when closed.
    const [mail, setMail] = useState(null);

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

    const remind = async (a) => {
        try {
            await apiPost(`/api/tprm/distribution/assessments/${a.assessment_id}/remind`, {});
            tprmAlert.success("Reminder queued");
            load(); onChanged();
        } catch (e) { tprmAlert.apiError(e); }
    };

    /* Two separate actions on every row, in the same order and position on all
       of them. Outline envelope looks, solid plane acts - and the plane never
       opens the preview, because a button that sometimes sends and sometimes
       shows is a button people stop trusting. */
    const previewOne = (r) =>
        setMail({ ids: [r.assessment_id], previewOnly: true });

    const sendOne = async (r) => {
        const ok = await tprmAlert.confirm(
            `Email ${r.third_party_name} their questionnaire now?`,
            `It goes to ${r.recipient || "the security contact on file"}.`,
            "Yes, send it");
        if (!ok) return;
        setBusy(true);
        try {
            const res = await apiPost(`/api/tprm/distribution/${tenantId}/issue-email`,
                { assessmentIds: [r.assessment_id] });
            tprmAlert.success(`${res.sent} questionnaire queued`);
            load(); onChanged();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    /* Why a row cannot be mailed, in the words the modal uses. Returned rather
       than hidden: an icon that vanishes on some rows makes the column jump. */
    const blockedReason = (r) =>
        !r.tier ? "Not tiered yet - complete the Tiering step first"
            : !r.recipient ? "No security contact on file for this supplier"
                : null;

    if (!rows) return <div className="tprm-loading">Loading...</div>;

    const issued = rows.filter(r => r.state && r.state !== "ready").length;
    const back = rows.filter(r => ["returned", "imported"].includes(r.state)).length;
    const imported = rows.filter(r => r.state === "imported").length;

    return (
        <>
            {/* Chasing suppliers is the slowest part of an engagement. The four
                numbers say where the whole population is before any of the
                per-supplier rows are read. */}
            <div className="tprm-card" style={{ marginBottom: 18 }}>
                <div className="tprm-card-title" style={{ marginBottom: 14 }}>
                    Where the population actually is
                </div>
                <div className="tprm-statrow">
                    {[
                        [`${issued} of ${rows.length}`, "Questionnaires issued"],
                        [`${back} of ${rows.length}`, "Responses received"],
                        [String(imported), "Imported and scored"],
                        [String(rows.length - back), "Still outstanding"],
                    ].map(([n, label]) => (
                        <div key={label}>
                            <div className="tprm-statrow-n">{n}</div>
                            <div className="tprm-statrow-l">{label}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="tprm-grid k2" style={{ marginBottom: 18 }}>
                <div className="tprm-card tprm-route" style={{ borderTopColor: "var(--tprm-blue)" }}>
                    <div className="tprm-route-title">Route A. Client distributes</div>
                    <p className="tprm-route-why">
                        One ZIP of every workbook. The client forwards each file to its own
                        supplier, which keeps us out of the supplier relationship.
                    </p>
                    <button className="tprm-btn primary" onClick={zip} disabled={busy}>
                        Download ZIP
                    </button>
                </div>
                <div className="tprm-card tprm-route" style={{ borderTopColor: "var(--tprm-purple)" }}>
                    <div className="tprm-route-title">Route B. We email each supplier</div>
                    <p className="tprm-route-why">
                        The tool emails each supplier its own workbook using the contact from the
                        intake sheet. Faster, but we are the ones chasing.
                    </p>
                    <button
                        className="tprm-btn primary"
                        onClick={() => setMail({ previewOnly: false })}
                        disabled={busy}
                    >
                        Email all outstanding
                    </button>
                </div>
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
                                {/* Same three actions, same order, on every row.
                                    Disabled rather than removed when a row is not
                                    sendable, so the icons never move about. */}
                                <td>
                                    <div className="tprm-rowacts">
                                        <button
                                            className="tprm-iconbtn"
                                            title={`Preview the email to ${r.third_party_name}`}
                                            aria-label="Preview the email"
                                            onClick={() => previewOne(r)}
                                        >
                                            <FaRegEnvelopeOpen />
                                        </button>
                                        <button
                                            className="tprm-iconbtn solid"
                                            title={blockedReason(r) || `Send ${r.third_party_name} their questionnaire`}
                                            aria-label="Send the email"
                                            disabled={busy || !!blockedReason(r)}
                                            onClick={() => sendOne(r)}
                                        >
                                            <FaPaperPlane />
                                        </button>
                                        <button
                                            className="tprm-btn sm"
                                            disabled={!r.recipient || r.state === "imported" || !r.state}
                                            title={!r.state ? "Not issued yet" : undefined}
                                            onClick={() => remind(r)}
                                        >
                                            Remind
                                        </button>
                                    </div>
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

            <TPRMMailPreview
                open={!!mail}
                title={mail && mail.previewOnly ? "Email preview" : "Send questionnaires"}
                rosterUrl={`/api/tprm/distribution/${tenantId}/email/recipients`}
                previewUrl={`/api/tprm/distribution/${tenantId}/email/preview`}
                ids={mail && mail.ids}
                idKey="assessmentId"
                rosterKey="assessmentIds"
                previewOnly={!!(mail && mail.previewOnly)}
                onClose={() => setMail(null)}
                onSend={async (checkedIds) => {
                    const res = await apiPost(`/api/tprm/distribution/${tenantId}/issue-email`,
                        { assessmentIds: checkedIds });
                    // Refetch before the modal closes, so the Status and Issued
                    // columns are right the moment it does. Leaving the row stale
                    // until a manual reload is the classic bug in this pattern.
                    await load(); onChanged();
                    return {
                        sent: res.sent || 0,
                        skipped: (res.skipped || []).length,
                        failed: 0,
                    };
                }}
            />
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
                <div className="tprm-dropzone">
                    <div className="tprm-dropzone-title">Drop the returned workbook or ZIP</div>
                    <div className="tprm-dropzone-sub">
                        Every workbook inside is matched by its hidden identity sheet, never by
                        file name
                    </div>
                    <input
                        ref={fileRef} type="file" accept=".xlsx,.zip" style={{ display: "none" }}
                        onChange={e => doPreview(e.target.files[0])} disabled={busy}
                    />
                    <button
                        className="tprm-btn primary"
                        onClick={() => fileRef.current && fileRef.current.click()}
                        disabled={busy}
                    >
                        {busy ? "Reading..." : "Choose file"}
                    </button>
                </div>
            </div>

            {busy && <div className="tprm-loading">Reading...</div>}

            {preview && (
                <>
                    <div className="tprm-page-actions" style={{ marginLeft: 0, marginBottom: 14 }}>
                        <button
                            className="tprm-btn gold" onClick={commit}
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
