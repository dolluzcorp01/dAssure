// The standards catalogue: every obligation the question bank maps to, and how
// much of the library actually carries that mapping.
//
// The count is the point. A standard listed here that no published instrument
// maps to is a claim we cannot evidence, and that has to be visible on the page
// rather than discovered when a client asks.

import React, { useEffect, useState } from "react";
import { apiJson } from "./utils/api";

// The reference's families, each with its own colour so the catalogue groups
// visually as well as by sort order.
const FAMILY_CHIP = {
    Universal: "navy",
    Privacy: "purple",
    Regulatory: "red",
    OT: "amber",
    Automotive: "blue",
    "Life Sciences": "green",
    Emerging: "gold",
    Assurance: "faint",
};

function TPRMStandards() {
    const [d, setD] = useState(null);
    const [err, setErr] = useState(null);

    useEffect(() => {
        apiJson("/api/tprm/library/standards")
            .then(d2 => { setD(d2); setErr(null); })
            .catch(setErr);
    }, []);

    if (err) {
        return (
            <div className="tprm-page">
                <div className="tprm-note danger">
                    <b>The standards catalogue could not be loaded.</b>
                    <div style={{ marginTop: 6 }}>
                        {err.message || "The request failed."}
                        {err.status ? <span className="code">{"  [HTTP " + err.status + "]"}</span> : null}
                    </div>
                    <div style={{ marginTop: 8 }}>
                        A 401 or 403 here means the session has expired - sign in again.
                    </div>
                </div>
            </div>
        );
    }

    if (!d) return <div className="tprm-loading">Loading standards...</div>;

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <h1 className="tprm-page-title">Standards</h1>
                    <div className="tprm-page-sub">
                        Every control question carries its mapping, so a client can see which
                        obligation each answer satisfies.
                    </div>
                </div>
            </div>

            <div className="tprm-card flush" style={{ overflowX: "auto" }}>
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Code</th>
                            <th>Title</th>
                            <th>Family</th>
                            <th>Published instruments using it</th>
                        </tr>
                    </thead>
                    <tbody>
                        {d.standards.map(s => (
                            <tr key={s.standard_code}>
                                <td className="mono tprm-std-code">{s.standard_code}</td>
                                <td>
                                    {s.title}
                                    {s.scope_note && (
                                        <div className="tprm-std-note">{s.scope_note}</div>
                                    )}
                                </td>
                                <td>
                                    <span className={"tprm-chip " + (FAMILY_CHIP[s.family] || "faint")}>
                                        {s.family}
                                    </span>
                                </td>
                                {/* Nothing mapped yet reads as nothing mapped, not as a zero
                                    hiding among real counts. */}
                                <td className={"mono" + (s.instruments ? "" : " tprm-std-unmapped")}>
                                    {s.instruments} of {d.total}
                                </td>
                            </tr>
                        ))}
                        {d.standards.length === 0 && (
                            <tr>
                                <td colSpan={4} className="tprm-empty">
                                    No standards in the catalogue.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default TPRMStandards;
