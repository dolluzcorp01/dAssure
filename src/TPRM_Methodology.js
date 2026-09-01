import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPut } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_Methodology.css";

/* One dial. A weight is a proportion tuned against its neighbours, so the
   control is a slider: a column of them shows the relative sizes at a glance,
   where a column of number boxes makes you do the arithmetic yourself. The
   monospace readout keeps the exact value visible, so nothing is lost by not
   typing it. */
function Dial({ label, note, value, onChange, min, max, step, format }) {
    return (
        <div className="tprm-meth-row">
            <div className="tprm-meth-label">
                <div className="tprm-meth-name">{label}</div>
                {note && <div className="tprm-meth-note">{note}</div>}
            </div>
            <input
                type="range"
                className="tprm-meth-slider"
                min={min} max={max} step={step}
                value={value}
                aria-label={label}
                onChange={e => onChange(Number(e.target.value))}
            />
            <span className="tprm-meth-value mono">{format(value)}</span>
        </div>
    );
}

const f2 = (v) => Number(v || 0).toFixed(2);
const fInt = (v) => String(Math.round(Number(v || 0)));

function TPRMMethodology() {
    const { tenantId, tenant } = useAccess();
    const [m, setM] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        if (!tenantId) return;
        setM(null);
        apiJson(`/api/tprm/clients/${tenantId}/methodology`).then(setM).catch(() => setM(null));
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    if (!tenantId) {
        return <div className="tprm-page"><div className="tprm-note warn">Select a client first.</div></div>;
    }
    if (!m) return <div className="tprm-loading">Loading the methodology...</div>;

    const dimTotal = Object.values(m.dimensionWeights).reduce((a, b) => a + Number(b), 0);
    const balanced = Math.abs(dimTotal - 1) < 0.001;

    const setDim = (code, v) =>
        setM({ ...m, dimensionWeights: { ...m.dimensionWeights, [code]: Number(v) } });

    const setDom = (code, v) =>
        setM({ ...m, domainWeights: { ...m.domainWeights, [code]: Number(v) } });

    const save = async () => {
        setBusy(true);
        try {
            const r = await apiPut(`/api/tprm/clients/${tenantId}/methodology`, {
                dimensionWeights: m.dimensionWeights,
                domainWeights: m.domainWeights,
                tier1Threshold: m.tier1Threshold,
                tier2Threshold: m.tier2Threshold,
                sla: m.sla,
            });
            tprmAlert.success("Methodology saved", r.message);
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <div className="tprm-page-sub">
                        {tenant ? tenant.tenant_name : ""} &nbsp;|&nbsp; These dials are per client.
                        Assessments already approved keep the scores they were approved on.
                    </div>
                </div>
                <div className="tprm-page-actions">
                    <button className="tprm-btn gold" onClick={save} disabled={busy || !balanced}>
                        {busy ? "Saving..." : "Save methodology"}
                    </button>
                </div>
            </div>

            <div className="tprm-grid k2">
                <div className="tprm-card">
                    {/* The running total sits on the header row rather than in a
                        banner below it: it is a property of this group, and it is
                        the one thing that decides whether Save is live. */}
                    <div className="tprm-meth-head">
                        <div className="tprm-card-title">Inherent risk dimension weights</div>
                        <span className={"tprm-chip " + (balanced ? "green" : "red")}>
                            {balanced ? "BALANCED 1.00" : `OUT OF BALANCE ${dimTotal.toFixed(2)}`}
                        </span>
                    </div>
                    {m.dimensions.map(d => (
                        <Dial
                            key={d.dimension_code}
                            label={d.dimension_name}
                            note={d.note}
                            value={m.dimensionWeights[d.dimension_code] ?? 0}
                            onChange={v => setDim(d.dimension_code, v)}
                            min={0} max={0.6} step={0.01} format={f2}
                        />
                    ))}

                    <div className="tprm-meth-head" style={{ marginTop: 24 }}>
                        <div className="tprm-card-title">Tier thresholds</div>
                    </div>
                    <div className="tprm-note" style={{ marginBottom: 12 }}>
                        An inherent score at or above the Tier 1 threshold is Tier 1. At or above the
                        Tier 2 threshold is Tier 2. Everything else is Tier 3.
                    </div>
                    <Dial
                        label="Tier 1, Critical, score at or above"
                        value={m.tier1Threshold}
                        onChange={v => setM({ ...m, tier1Threshold: v })}
                        min={1} max={3} step={0.05} format={f2}
                    />
                    <Dial
                        label="Tier 2, Significant, score at or above"
                        note={Number(m.tier2Threshold) >= Number(m.tier1Threshold)
                            ? "Tier 2 must stay below Tier 1 — the database refuses it either way"
                            : undefined}
                        value={m.tier2Threshold}
                        onChange={v => setM({ ...m, tier2Threshold: v })}
                        min={1} max={3} step={0.05} format={f2}
                    />

                    <div className="tprm-meth-head" style={{ marginTop: 24 }}>
                        <div className="tprm-card-title">Remediation SLA, in days</div>
                    </div>
                    {["Critical", "High", "Medium", "Low"].map(sev => (
                        <Dial
                            key={sev}
                            label={sev}
                            value={m.sla[sev] ?? 30}
                            onChange={v => setM({ ...m, sla: { ...m.sla, [sev]: v } })}
                            min={1} max={120} step={1} format={fInt}
                        />
                    ))}
                </div>

                <div className="tprm-card">
                    <div className="tprm-meth-head">
                        <div className="tprm-card-title">Control area weights</div>
                    </div>
                    <div className="tprm-note" style={{ marginBottom: 14 }}>
                        Effectiveness is weighted by control area rather than averaged flat, so a
                        weak access control area is not cancelled out by a strong policy area.
                        These need not total anything in particular — only their ratios matter.
                    </div>
                    {m.domains.map(d => (
                        <Dial
                            key={d.domain_code}
                            label={d.domain_name}
                            value={m.domainWeights[d.domain_code] ?? d.default_weight}
                            onChange={v => setDom(d.domain_code, v)}
                            min={0} max={20} step={1} format={fInt}
                        />
                    ))}
                </div>
            </div>

            <div className="tprm-card" style={{ marginTop: 18 }}>
                <div className="tprm-card-title" style={{ marginBottom: 10 }}>HOW A SCORE IS BUILT</div>
                <div className="tprm-meth-formula">
                    <div><b>Inherent risk</b> = weighted mean of the tiering answers, 1 to 3</div>
                    <div><b>Effectiveness</b> = weighted mean across control areas, where Compliant scores 2,
                        Partially Compliant 1, <b>Not Evidenced 1</b>, Non-Compliant 0, and Not Applicable is
                        excluded from the denominator entirely</div>
                    <div><b>Residual risk</b> = inherent &times; (1 &minus; effectiveness)</div>
                </div>
                <div className="tprm-note warn" style={{ marginTop: 14 }}>
                    Not Evidenced scoring 1 rather than 0 is deliberate. An unproven claim is not the
                    same as a proven failure, but it is not a pass either. Residual risk is always
                    derived, never typed in.
                </div>
            </div>
        </div>
    );
}

export default TPRMMethodology;
