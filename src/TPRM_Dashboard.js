import React, { useEffect, useState } from "react";
import { apiJson } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import "./TPRM_Dashboard.css";

const STATE_LABEL = {
    draft: "Draft", in_progress: "In progress", on_hold: "On hold",
    under_review: "Under review", approved: "Approved", issued: "Issued", closed: "Closed",
};

function TPRMDashboard() {
    const { tenant, tenantId } = useAccess();
    const [d, setD] = useState(null);
    const [err, setErr] = useState(null);

    useEffect(() => {
        if (!tenantId) return;
        setD(null); setErr(null);
        apiJson(`/api/tprm/clients/${tenantId}/dashboard`).then(setD).catch(setErr);
    }, [tenantId]);

    if (!tenantId) {
        return (
            <div className="tprm-page">
                <div className="tprm-note warn">
                    No client is assigned to your account yet. Ask a Practice Head or Engagement
                    Manager to grant you a role on an engagement.
                </div>
            </div>
        );
    }
    if (err) return <div className="tprm-page"><div className="tprm-note danger">{err.message}</div></div>;
    if (!d) return <div className="tprm-loading">Loading the programme position...</div>;

    const k = d.kpi;
    const maxTier = Math.max(1, ...d.tiers.map(t => Number(t.n)));

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <h1 className="tprm-page-title">{tenant ? tenant.tenant_name : "Dashboard"}</h1>
                    <div className="tprm-page-sub">Programme position</div>
                </div>
            </div>

            <div className="tprm-grid k4" style={{ marginBottom: 20 }}>
                {[
                    ["Third parties", k.third_parties, "var(--tprm-navy)", "in the register"],
                    ["Tier 1 coverage", k.tier1_coverage_pct + "%", "var(--tprm-blue)",
                        `${k.tier1_done} of ${k.tier1_total} assessed`],
                    ["Open critical findings", k.open_critical, "var(--tprm-red)", "awaiting remediation"],
                    ["SLA breached", k.breached, "var(--tprm-amber)", "past the agreed date"],
                ].map(x => (
                    <div className="tprm-card tprm-kpi" key={x[0]} style={{ borderTopColor: x[2] }}>
                        <div className="tprm-kpi-label">{x[0]}</div>
                        <div className="tprm-kpi-value" style={{ color: x[2] }}>{x[1]}</div>
                        <div className="tprm-kpi-sub">{x[3]}</div>
                    </div>
                ))}
            </div>

            <div className="tprm-grid k2">
                <div className="tprm-card">
                    <div className="tprm-card-title" style={{ marginBottom: 14 }}>TIER DISTRIBUTION</div>
                    {d.tiers.length === 0 && <div className="tprm-empty">Nothing has been tiered yet.</div>}
                    {d.tiers.map(t => {
                        const colors = ["var(--tprm-red)", "var(--tprm-amber)", "var(--tprm-green)"];
                        const c = colors[t.tier - 1];
                        return (
                            <div className="tprm-dash-bar" key={t.tier}>
                                <span className="tprm-chip" style={{ background: "#F1F4F7", color: c }}>
                                    TIER {t.tier}
                                </span>
                                <div className="tprm-dash-track">
                                    <div
                                        className="tprm-dash-fill"
                                        style={{ width: `${(Number(t.n) / maxTier) * 100}%`, background: c }}
                                    />
                                </div>
                                <b className="mono">{t.n}</b>
                            </div>
                        );
                    })}

                    <div className="tprm-card-title" style={{ margin: "22px 0 12px" }}>ASSESSMENT STATES</div>
                    {d.states.length === 0 && <div className="tprm-empty">No assessments yet.</div>}
                    {d.states.map(s => (
                        <div className="tprm-dash-row" key={s.state}>
                            <span>{STATE_LABEL[s.state] || s.state}</span>
                            <b className="mono">{s.n}</b>
                        </div>
                    ))}
                </div>

                <div className="tprm-card">
                    <div className="tprm-card-title" style={{ marginBottom: 14 }}>CONCENTRATION BY SECTOR</div>
                    {d.exposure.length === 0 && <div className="tprm-empty">No suppliers in the register yet.</div>}
                    {d.exposure.map(e => (
                        <div className="tprm-dash-row" key={e.sector}>
                            <span>{e.sector}</span>
                            <b className="mono">{e.n}</b>
                        </div>
                    ))}

                    <div className="tprm-card-title" style={{ margin: "22px 0 12px" }}>OPEN FINDINGS BY SEVERITY</div>
                    {d.severity.length === 0 && (
                        <div className="tprm-note good">No open findings on this client.</div>
                    )}
                    {d.severity.map(s => (
                        <div className="tprm-dash-row" key={s.severity}>
                            <span className={"tprm-chip " + (
                                s.severity === "Critical" ? "red"
                                    : s.severity === "High" ? "amber"
                                        : s.severity === "Medium" ? "blue" : "grey")}>
                                {s.severity}
                            </span>
                            <b className="mono">{s.n}</b>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default TPRMDashboard;
