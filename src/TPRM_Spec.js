// The build-spec drawer behind "Show spec" in the header.
//
// It says what the screen you are on is for, who is meant to see it, and which
// API calls it makes. The notes are the reference's own, copied rather than
// rewritten, so the thing being built and the thing being described cannot
// quietly diverge.
//
// This is a reading device. It never changes anything, and it is never the
// authority on access - the permission matrix is, and the API checks it again
// on every request.

import React from "react";
import { useLocation } from "react-router-dom";
import { SPECS, API_MAP } from "./utils/tprmSpecs";
import "./TPRM_Spec.css";

// Route to the reference's spec key. Longest match wins, so /Assessments/12
// still reads as the assessment spec.
const SPEC_FOR = [
    ["/assessments", "assess"],
    ["/third_parties", "pop"],
    ["/vendor_population", "pop"],
    ["/users_and_roles", "users"],
    ["/question_bank", "qbank"],
    ["/audit_trail", "audit"],
    ["/methodology", "methodology"],
    ["/my_account", "account"],
    ["/standards", "standards"],
    ["/dashboard", "dash"],
    ["/findings", "findings"],
    ["/reports", "reports"],
    ["/banners", "banners"],
    ["/clients", "clients"],
];

// The population pipeline is one route with seven steps, and each step has a
// spec of its own in the reference. The step is in the query string, so the
// drawer can follow it rather than reading "Vendor population" on all seven.
const SPEC_FOR_STEP = {
    template: "tpl", upload: "upl", classify: "cls", triage: "tri",
    tiering: "tier", distribute: "dist", import: "zip",
};

export function specIdFor(pathname, search) {
    const p = String(pathname || "").toLowerCase();

    if (p === "/vendor_population") {
        const step = new URLSearchParams(search || "").get("step");
        if (step && SPEC_FOR_STEP[step]) return SPEC_FOR_STEP[step];
    }

    const hit = SPEC_FOR
        .filter(([route]) => p === route || p.startsWith(route + "/"))
        .sort((a, b) => b[0].length - a[0].length)[0];
    return hit ? hit[1] : null;
}

const METHOD_CLASS = { GET: "get", DELETE: "del" };

function TPRMSpec({ open, onClose }) {
    const { pathname, search } = useLocation();
    const id = specIdFor(pathname, search);
    const s = id ? SPECS[id] : null;
    const api = (id && API_MAP[id]) || [];

    // Rendered even when closed, at zero width, so opening and closing are the
    // same animation rather than a mount and a slide.
    return (
        <aside
            className={"tprm-spec" + (open && s ? " open" : "")}
            aria-hidden={!open || !s}
        >
            {s && (
                <div className="tprm-spec-inner">
                    <div className="tprm-spec-head">
                        <div>
                            <div className="tprm-spec-eyebrow">BUILD SPEC</div>
                            <div className="tprm-spec-title">{s.t}</div>
                        </div>
                        <button
                            className="tprm-spec-close"
                            onClick={onClose}
                            aria-label="Close the build spec"
                        >
                            &times;
                        </button>
                    </div>

                    <div className="tprm-spec-who">VISIBLE TO: {s.who}</div>
                    <div className="tprm-spec-rule" />

                    {s.notes.map((n, i) => (
                        <div className="tprm-spec-note" key={i}>
                            <span className="tprm-spec-num">{String(i + 1).padStart(2, "0")}</span>
                            <span>{n}</span>
                        </div>
                    ))}

                    {api.length > 0 && (
                        <div className="tprm-spec-api">
                            <div className="tprm-spec-apilabel">API CALLS THIS SCREEN MAKES</div>
                            {api.map((a, i) => (
                                <div className="tprm-spec-call" key={i}>
                                    <div className="tprm-spec-callhead">
                                        <span className={"tprm-spec-method " + (METHOD_CLASS[a[0]] || "write")}>
                                            {a[0]}
                                        </span>
                                        <span className="tprm-spec-path">{a[1]}</span>
                                    </div>
                                    <div className="tprm-spec-calldesc">{a[2]}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </aside>
    );
}

export default TPRMSpec;
