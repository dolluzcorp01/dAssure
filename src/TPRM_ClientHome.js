// A client's own overview: what has been set up, and what has not.
//
// The checklist is the answer to "I have just made a client, now what". Every
// step is derived from whether the thing actually exists rather than from a
// stored flag, so deleting the last third party puts step four back to
// incomplete instead of leaving the page confidently wrong.
//
// Only the first incomplete step offers a button. A checklist where every
// unfinished row shouts is a checklist nobody reads in order.

import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiJson } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import "./TPRM_ClientHome.css";

function stepsFor(ctx, o) {
    const t = o.team || {};
    const people = [
        t.internal ? `${t.internal} internal` : null,
        t.viewers ? `${t.viewers} client viewer${t.viewers === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(", ");

    return [
        {
            title: "Client created",
            done: true,
            sub: `${ctx.name}, code ${ctx.code}`,
        },
        {
            title: "Methodology set",
            done: Boolean(o.methodology && o.methodology.balanced),
            sub: o.methodology
                ? `Tier 1 at ${o.methodology.tier1.toFixed(2)}, `
                  + `Tier 2 at ${o.methodology.tier2.toFixed(2)}, `
                  + `weights ${o.methodology.balanced ? "balanced" : "do not total 1.00"}`
                : "The tiering weights, thresholds and remediation SLA",
            to: "/Methodology",
            cta: "Open the methodology",
        },
        {
            title: "Team granted",
            // One person is the person who made it. A team is somebody else too.
            done: Number(t.total || 0) > 1,
            sub: people
                ? `${people} on this engagement`
                : "Only you. Grant your colleagues a role on this client",
            to: "/Users_And_Roles",
            cta: "Grant a role",
        },
        {
            title: "Third parties added",
            done: Number(o.thirdParties || 0) > 0,
            sub: o.thirdParties
                ? `${o.thirdParties} on the register`
                : "Add the suppliers to be assessed. This is where the vendor sector is chosen",
            to: "/Vendor_Population",
            cta: "Open the population pipeline",
        },
        {
            title: "Assessments assigned",
            done: Number(o.assessmentsAssigned || 0) > 0,
            sub: o.assessmentsAssigned
                ? `${o.assessmentsAssigned} assigned to an assessor`
                : "Assign each third party to an assessor with a due date",
            to: "/Assessments",
            cta: "Open assessments",
        },
        {
            title: "First report issued",
            done: Number(o.reportsIssued || 0) > 0,
            sub: o.reportsIssued
                ? `${o.reportsIssued} issued to the client`
                : "Available once an assessment reaches Approved",
            to: "/Reports",
            cta: "Open reports",
        },
    ];
}

function TPRMClientHome() {
    const { tenantId: param } = useParams();
    const navigate = useNavigate();
    const { tenantId, setTenant, hasPerm } = useAccess();
    const [ctx, setCtx] = useState(null);
    const [o, setO] = useState(null);
    const [err, setErr] = useState(null);

    // Opening a client by URL selects it. Otherwise the page would describe one
    // client while the selector, and every API call it drives, meant another.
    useEffect(() => {
        if (param && String(param) !== String(tenantId)) setTenant(Number(param));
    }, [param, tenantId, setTenant]);

    useEffect(() => {
        if (!param) return;
        setCtx(null); setO(null); setErr(null);
        apiJson(`/api/tprm/clients/${param}/context`).then(setCtx).catch(setErr);
        apiJson(`/api/tprm/clients/${param}/overview`).then(setO).catch(setErr);
    }, [param]);

    if (err) {
        return (
            <div className="tprm-page">
                <div className="tprm-note danger">{err.message || "Could not load this client"}</div>
            </div>
        );
    }
    if (!ctx || !o) return <div className="tprm-loading">Loading the client...</div>;

    const steps = stepsFor(ctx, o);
    const done = steps.filter(s => s.done).length;
    const next = steps.find(s => !s.done);
    const facts = [ctx.sectorName, (ctx.regions || [])[0], ctx.scaleBand].filter(Boolean);

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <h1 className="tprm-page-title">{ctx.name}</h1>
                    <div className="tprm-page-sub">
                        <b className="mono tprm-ch-code">{ctx.code}</b>
                        {facts.length > 0 && "  |  " + facts.join("  |  ")}
                    </div>
                    {ctx.overlay && ctx.overlay.length > 0 && (
                        <div className="tprm-ch-overlay">
                            {ctx.overlay.map(x => <span className="tprm-chip gold" key={x}>{x}</span>)}
                        </div>
                    )}
                </div>
                {hasPerm("vendor.manage") && (
                    <div className="tprm-page-actions">
                        <button className="tprm-btn gold"
                            onClick={() => navigate("/Vendor_Population")}>
                            Add third parties
                        </button>
                    </div>
                )}
            </div>

            <div className="tprm-ch-cols">
                <div className="tprm-card tprm-ch-list">
                    <div className="tprm-ch-listhead">
                        <div className="tprm-lab">Onboarding checklist</div>
                        <span className="tprm-ch-count">{done} of {steps.length} complete</span>
                    </div>

                    <div className="tprm-ch-track">
                        <div className="tprm-ch-fill"
                            style={{ width: (done / steps.length) * 100 + "%" }} />
                    </div>

                    {steps.map(s => (
                        <div className="tprm-ch-step" key={s.title}>
                            <div className={"tprm-ch-tick" + (s.done ? " done" : "")}>
                                {s.done ? "✓" : ""}
                            </div>
                            <div className="tprm-ch-body">
                                <div className={"tprm-ch-title" + (s.done ? " done" : "")}>
                                    {s.title}
                                </div>
                                <div className="tprm-ch-sub">{s.sub}</div>
                            </div>
                            {/* Only the next thing to do gets a button. */}
                            {next === s && s.to && (
                                <button className="tprm-btn sm primary"
                                    onClick={() => navigate(s.to)}>
                                    {s.cta}
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                <div className="tprm-ch-side">
                    <div className="tprm-card tprm-ch-context">
                        <div className="tprm-lab">Context inherited by every assessment</div>
                        <p className="tprm-ch-prose">
                            Every vendor questionnaire issued for {ctx.tradingName || ctx.code} carries
                            {ctx.sectorName ? ` the ${ctx.sectorName.toLowerCase()} regulatory overlay,` : " the regulatory overlay,"}
                            {(ctx.regions || []).length ? ` ${ctx.regions.join(" and ")} jurisdiction,` : ""}
                            {ctx.scaleBand ? ` ${ctx.scaleBand.toLowerCase()},` : ""} and the declared
                            data types.
                        </p>
                        <p className="tprm-ch-prose">
                            The vendor sector, chosen when a supplier is classified, decides which
                            instrument is actually issued to them. The client sector above does not.
                        </p>

                        {(ctx.dataTypes || []).length > 0 && (
                            <>
                                <div className="tprm-lab tprm-ch-spaced">Data types in scope</div>
                                <div className="tprm-ch-chips">
                                    {ctx.dataTypes.map(x => (
                                        <span className="tprm-chip green" key={x}>{x}</span>
                                    ))}
                                </div>
                            </>
                        )}

                        {(ctx.regulators || []).length > 0 && (
                            <>
                                <div className="tprm-lab tprm-ch-spaced">Applicable regulators</div>
                                <div className="tprm-ch-chips">
                                    {ctx.regulators.map(x => (
                                        <span className="tprm-chip purple" key={x}>{x}</span>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default TPRMClientHome;
