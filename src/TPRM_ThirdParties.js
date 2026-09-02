// The third party register: every supplier on the client you are working on,
// with the standing of its most recent assessment beside it.
//
// This is the Overview tab of the client workspace. The bar above it names the
// engagement and carries the other four tabs; this page is the register and
// nothing else.
//
// Getting suppliers INTO the register - intake template, upload, classify,
// triage - is the pipeline, which is a different job with a different shape.
// It lives behind the Vendor Population tab rather than in this table.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "./utils/api";
import { useAccess } from "./utils/AccessContext";

const TIER_CHIP = ["red", "amber", "green"];

const BAND_CHIP = {
    CRITICAL: "red", HIGH: "amber", MEDIUM: "blue", LOW: "green",
};

/** The word for a supplier that has no assessment to report on yet. */
function standing(r) {
    if (r.in_scope === 0) return "descoped";
    if (!r.assessment_id) return "not assessed";
    return String(r.assessment_state || "").replace(/_/g, " ");
}

/* Where a supplier with no assessment is actually waiting.
   Dropping someone on the pipeline generally means "it is somewhere in these
   seven screens, go and find it", which is not an answer - and they lose the
   row they clicked on the way. Open goes to the step that is holding this
   particular supplier up, carrying its id so the step can point at it.

   Tiering takes the id too, though it has no register to highlight: it is a
   pack you download and send, so the step itself is the destination. */
function blockedAt(r) {
    if (!r.sector_confirmed_time) return "classify";
    if (r.in_scope === null || r.in_scope === undefined) return "triage";
    if (Number(r.in_scope) === 0) return "triage";
    return "tiering";
}

const STEP_WORD = {
    classify: "confirm its instrument",
    triage: "make its scope decision",
    tiering: "tier it",
};

const pct = v => (v === null || v === undefined ? "-" : Math.round(v * 100) + "%");
const num = v => (v === null || v === undefined ? "-" : v);

function TPRMThirdParties() {
    const navigate = useNavigate();
    const { tenantId, hasPerm } = useAccess();
    const [rows, setRows] = useState(null);

    useEffect(() => {
        let live = true;
        setRows(null);
        if (!tenantId) { setRows([]); return undefined; }
        apiJson("/api/tprm/vendors/" + tenantId + "/third-parties")
            .then(r => { if (live) setRows(r); })
            .catch(() => { if (live) setRows([]); });
        return () => { live = false; };
    }, [tenantId]);

    return (
        <div className="tprm-page">
            {!tenantId ? (
                <div className="tprm-note warn">Select a client first.</div>
            ) : !rows ? (
                <div className="tprm-loading">Loading third parties...</div>
            ) : (
                <>
                    <div className="tprm-page-head">
                        <div>
                            <h1 className="tprm-page-title">Third parties</h1>
                            <div className="tprm-page-sub">
                                The register for this client, and where each supplier has got to.
                            </div>
                        </div>
                        {hasPerm("vendor.manage") && (
                            <div className="tprm-page-actions">
                                <button
                                    className="tprm-btn"
                                    onClick={() => navigate("/Vendor_Population")}
                                >
                                    Open the population pipeline
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="tprm-card flush" style={{ overflowX: "auto" }}>
                        <table className="tprm-table">
                            <thead>
                                <tr>
                                    <th style={{ minWidth: 260 }}>Third party</th>
                                    <th>Instrument</th>
                                    <th>Tier</th>
                                    <th>Inherent</th>
                                    <th>Effectiveness</th>
                                    <th>Residual</th>
                                    <th>State</th>
                                    <th>Findings</th>
                                    <th className="tprm-col-actions" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    // A descoped supplier stays on the register - the decision to
                                    // leave it out is part of the record - but it is dimmed, so it
                                    // never reads as work in flight.
                                    <tr key={r.third_party_id}
                                        className={r.in_scope === 0 ? "tprm-tp-out" : undefined}>
                                        <td>
                                            <div className="tprm-ident">
                                                <span className="tprm-ident-ref">{r.ref_code}</span>
                                                <span className="tprm-ident-name">
                                                    {r.third_party_name}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="tprm-tp-instrument">{r.sector_name || "-"}</td>
                                        <td>
                                            {r.tier
                                                ? <span className={"tprm-chip " + TIER_CHIP[r.tier - 1]}>
                                                    TIER {r.tier}</span>
                                                : <span className="tprm-chip faint">NOT TIERED</span>}
                                        </td>
                                        <td className="mono">{num(r.inherent_score)}</td>
                                        <td className="mono">{pct(r.effectiveness)}</td>
                                        <td className="mono tprm-tp-residual">{num(r.residual_score)}</td>
                                        <td>
                                            {r.residual_band
                                                ? <span className={"tprm-chip " + (BAND_CHIP[r.residual_band] || "grey")}>
                                                    {r.residual_band}</span>
                                                : <span className="tprm-chip faint">{standing(r)}</span>}
                                        </td>
                                        <td className="mono">{r.open_findings}</td>
                                        <td className="tprm-col-actions">
                                            {/* Always offered. A supplier with no assessment yet is
                                                not a dead end - it is work waiting at a particular
                                                step, and that step is where Open takes you. */}
                                            <button
                                                className="tprm-btn sm primary"
                                                title={r.assessment_id
                                                    ? "Open the assessment"
                                                    : "Go to the pipeline to "
                                                      + STEP_WORD[blockedAt(r)]}
                                                onClick={() => navigate(r.assessment_id
                                                    ? "/Assessments/" + r.assessment_id
                                                    : "/Vendor_Population?step=" + blockedAt(r)
                                                      + "&tp=" + r.third_party_id)}
                                            >
                                                Open
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {rows.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="tprm-empty">
                                            No third parties on this client yet. The population
                                            pipeline is where they come from.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

export default TPRMThirdParties;
