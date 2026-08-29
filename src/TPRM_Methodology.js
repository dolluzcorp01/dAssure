import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPut } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_Methodology.css";

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
                    <h1 className="tprm-page-title">Methodology</h1>
                    <div className="tprm-page-sub">
                        {tenant ? tenant.tenant_name : ""} &nbsp;|&nbsp; These dials are per client.
                        Assessments already approved keep the scores they were approved on.
                    </div>
                </div>
                <div className="tprm-page-actions">
                    <button className="tprm-btn primary" onClick={save} disabled={busy || !balanced}>
                        {busy ? "Saving..." : "Save methodology"}
                    </button>
                </div>
            </div>

            <div className="tprm-grid k2">
                <div className="tprm-card">
                    <div className="tprm-card-title" style={{ marginBottom: 6 }}>
                        INHERENT RISK DIMENSION WEIGHTS
                    </div>
                    <div className={"tprm-meth-total " + (balanced ? "ok" : "bad")}>
                        Total {dimTotal.toFixed(3)}
                        {balanced ? " — balanced" : " — must equal 1.000 before this can be saved"}
                    </div>
                    {m.dimensions.map(d => (
                        <div className="tprm-meth-row" key={d.dimension_code}>
                            <div>
                                <div className="tprm-meth-name">{d.dimension_name}</div>
                                <div className="tprm-meth-note">{d.note}</div>
                            </div>
                            <input
                                type="number" step="0.01" min="0" max="1"
                                className="tprm-input tprm-meth-input"
                                value={m.dimensionWeights[d.dimension_code] ?? 0}
                                onChange={e => setDim(d.dimension_code, e.target.value)}
                            />
                        </div>
                    ))}

                    <div className="tprm-card-title" style={{ margin: "24px 0 10px" }}>TIER THRESHOLDS</div>
                    <div className="tprm-note" style={{ marginBottom: 12 }}>
                        An inherent score at or above the Tier 1 threshold is Tier 1. At or above the
                        Tier 2 threshold is Tier 2. Everything else is Tier 3.
                    </div>
                    <div className="tprm-meth-row">
                        <div className="tprm-meth-name">Tier 1 threshold</div>
                        <input
                            type="number" step="0.05" min="1" max="3"
                            className="tprm-input tprm-meth-input"
                            value={m.tier1Threshold}
                            onChange={e => setM({ ...m, tier1Threshold: Number(e.target.value) })}
                        />
                    </div>
                    <div className="tprm-meth-row">
                        <div className="tprm-meth-name">Tier 2 threshold</div>
                        <input
                            type="number" step="0.05" min="1" max="3"
                            className="tprm-input tprm-meth-input"
                            value={m.tier2Threshold}
                            onChange={e => setM({ ...m, tier2Threshold: Number(e.target.value) })}
                        />
                    </div>

                    <div className="tprm-card-title" style={{ margin: "24px 0 10px" }}>
                        REMEDIATION SLA, IN DAYS
                    </div>
                    {["Critical", "High", "Medium", "Low"].map(sev => (
                        <div className="tprm-meth-row" key={sev}>
                            <div className="tprm-meth-name">{sev}</div>
                            <input
                                type="number" min="1" max="365"
                                className="tprm-input tprm-meth-input"
                                value={m.sla[sev] ?? 30}
                                onChange={e => setM({ ...m, sla: { ...m.sla, [sev]: Number(e.target.value) } })}
                            />
                        </div>
                    ))}
                </div>

                <div className="tprm-card">
                    <div className="tprm-card-title" style={{ marginBottom: 6 }}>CONTROL AREA WEIGHTS</div>
                    <div className="tprm-note" style={{ marginBottom: 14 }}>
                        Effectiveness is weighted by control area rather than averaged flat, so a
                        weak access control area is not cancelled out by a strong policy area.
                        These need not total anything in particular — only their ratios matter.
                    </div>
                    {m.domains.map(d => (
                        <div className="tprm-meth-row" key={d.domain_code}>
                            <div className="tprm-meth-name">{d.domain_name}</div>
                            <input
                                type="number" step="1" min="0" max="100"
                                className="tprm-input tprm-meth-input"
                                value={m.domainWeights[d.domain_code] ?? d.default_weight}
                                onChange={e => setDom(d.domain_code, e.target.value)}
                            />
                        </div>
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
