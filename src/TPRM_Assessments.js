import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import "./TPRM_Assessments.css";

const STATE_CHIP = {
    draft: "grey", in_progress: "blue", on_hold: "amber",
    under_review: "amber", approved: "green", issued: "green", closed: "grey",
};

const STATE_LABEL = {
    draft: "Draft", in_progress: "In progress", on_hold: "On hold",
    under_review: "Under review", approved: "Approved", issued: "Issued", closed: "Closed",
};

function TPRMAssessments() {
    const navigate = useNavigate();
    const { user, hasPerm } = useAccess();
    const [rows, setRows] = useState(null);
    const [mine, setMine] = useState(false);
    const [state, setState] = useState("all");

    const load = useCallback(() => {
        apiJson(`/api/tprm/assessments/list${mine ? "?mine=1" : ""}`)
            .then(setRows).catch(() => setRows([]));
    }, [mine]);

    useEffect(() => { load(); }, [load]);

    if (!rows) return <div className="tprm-loading">Loading assessments...</div>;

    const shown = state === "all" ? rows : rows.filter(r => r.state === state);

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <div className="tprm-page-sub">
                        Every supplier assessment in flight, across the clients you work on
                    </div>
                </div>
                <div className="tprm-page-actions">
                    <select
                        className="tprm-select" style={{ width: 170 }}
                        value={state} onChange={e => setState(e.target.value)}
                    >
                        <option value="all">All states</option>
                        {Object.entries(STATE_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                        ))}
                    </select>
                    <button
                        className={"tprm-btn" + (mine ? " navy" : "")}
                        onClick={() => setMine(m => !m)}
                    >
                        {mine ? "Showing mine" : "Assigned to me"}
                    </button>
                </div>
            </div>

            <div className="tprm-card flush">
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Ref</th><th>Third party</th><th>Client</th><th>Instrument</th>
                            <th>Tier</th><th>State</th><th>Progress</th><th>Residual</th>
                            <th>Findings</th><th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map(a => (
                            <tr key={a.assessment_id}>
                                <td className="num">{a.ref_code}</td>
                                <td style={{ fontWeight: 600 }}>{a.third_party_name}</td>
                                <td style={{ color: "var(--tprm-muted)", fontSize: 12 }}>{a.tenant_name}</td>
                                <td style={{ color: "var(--tprm-muted)", fontSize: 12 }}>{a.sector_name}</td>
                                <td>
                                    {a.tier
                                        ? <span className={"tprm-chip " + (
                                            a.tier === 1 ? "red" : a.tier === 2 ? "amber" : "green")}>
                                            TIER {a.tier}
                                        </span>
                                        : <span className="tprm-chip grey">not tiered</span>}
                                </td>
                                <td>
                                    <span className={"tprm-chip " + (STATE_CHIP[a.state] || "grey")}>
                                        {STATE_LABEL[a.state] || a.state}
                                    </span>
                                </td>
                                <td className="num">
                                    {a.answered}
                                    {Number(a.pending_assertions) > 0 && (
                                        <span className="tprm-chip amber" style={{ marginLeft: 6 }}>
                                            {a.pending_assertions} to accept
                                        </span>
                                    )}
                                </td>
                                <td className="num">
                                    {a.residual_score ?? "-"}
                                    {a.residual_band && (
                                        <span className="tprm-assess-band">{a.residual_band}</span>
                                    )}
                                </td>
                                <td className="num">{a.open_findings}</td>
                                <td>
                                    <button
                                        className="tprm-btn sm navy"
                                        onClick={() => navigate(`/Assessments/${a.assessment_id}`)}
                                    >
                                        Open
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {shown.length === 0 && (
                            <tr><td colSpan={10} className="tprm-empty">
                                {mine ? (
                                    `Nothing is assigned to ${user ? user.emp_name : "you"} right now.`
                                ) : (
                                    <>
                                        No assessments yet. An assessment starts when a supplier is
                                        tiered.
                                        {hasPerm("vendor.manage") && (
                                            <div style={{ marginTop: 12 }}>
                                                <button
                                                    className="tprm-btn primary sm"
                                                    onClick={() => navigate("/Vendor_Population")}
                                                >
                                                    Go to Vendor Population
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default TPRMAssessments;
