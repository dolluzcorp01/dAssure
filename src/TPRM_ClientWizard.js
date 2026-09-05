// Onboarding a client, in five steps.
//
// It was one modal with three fields. That modal wrote a tenant and then left
// six other things - operating context, the tiering dials, the SLA, the team -
// to be found and set later, on four different screens, by someone who did not
// know they were outstanding. This asks for all of it once, in the order the
// answers actually depend on each other, and writes nothing until step five.
//
// Nothing here is saved as you go. Leaving before step five leaves no trace,
// which is why the progress bar is a progress bar and not a set of tabs.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson, apiPost } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import TPRMSelect from "./TPRM_Select";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_ClientWizard.css";

const STEPS = ["Identity", "Operating context", "Methodology", "Team and access", "Review"];

// The regulatory overlay a client's own sector drags in. Shown so the person
// onboarding can see what they are committing every assessment to, and stored
// with the client as part of the captured context.
const OVERLAY = {
    "Power and Utilities": ["NERC CIP", "IEC 62443", "NIS2", "National grid code"],
    "Oil, Gas and Petroleum": ["API 1164", "TSA Pipeline SD", "IOGP 627", "IEC 62443"],
    "Banking and Capital Markets": ["DORA", "EBA Outsourcing", "PCI DSS", "Central bank framework"],
    Pharmaceutical: ["21 CFR Part 11", "EU GMP Annex 11", "GAMP 5", "ICH E6 R3"],
};
const OVERLAY_DEFAULT = ["ISO/IEC 27001", "ISO/IEC 27036", "NIST CSF 2.0"];

const REGIONS = ["Oman", "GCC", "India", "Europe", "United Kingdom", "United States",
    "Asia Pacific", "Africa"];
const REGULATORS = ["Ministry of Energy and Minerals", "Oman CERT", "Capital Market Authority",
    "Data Protection Authority"];
const SCALES = ["Small, under 250 staff", "Mid, 250 to 5000 staff", "Large, over 5000 staff",
    "Critical national infrastructure"];
const DATA_TYPES = ["Personal data", "Special category", "Payment data", "Operational technology",
    "Intellectual property", "Classified"];
const SECONDARY = ["Manufacturing and OT", "Logistics", "Construction", "IT and Software"];

const SLA_ROWS = [["Critical", 14, "red"], ["High", 30, "amber"],
    ["Medium", 60, "blue"], ["Low", 90, "faint"]];

/** A chip that toggles membership of a list. */
function Toggle({ on, tone, children, onClick }) {
    return (
        <button
            type="button"
            className={"tprm-chip tprm-wz-toggle" + (on ? " " + tone : " off")}
            aria-pressed={on}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

const toggled = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

function TPRMClientWizard() {
    const navigate = useNavigate();
    const { refetch, setupMode } = useAccess();
    const [step, setStep] = useState(0);
    const [saving, setSaving] = useState(false);

    const [sectors, setSectors] = useState([]);
    const [dims, setDims] = useState([]);
    const [roles, setRoles] = useState([]);
    const [employees, setEmployees] = useState([]);

    const [d, setD] = useState({
        legal: "", trading: "", code: "", sector: "",
        contactName: "", contactEmail: "",
        sec2: [], regions: ["Oman"], regs: [], scale: SCALES[2],
        dt: ["Personal data", "Operational technology"],
        weights: null, t1: 2.30, t2: 1.60,
        team: [], addEmp: "", addRole: "AS",
    });
    const set = (k, v) => setD(x => ({ ...x, [k]: v }));

    useEffect(() => {
        apiJson("/api/tprm/library/sectors").then(setSectors).catch(() => { });
        apiJson("/api/tprm/library/dimensions").then(setDims).catch(() => { });
        apiJson("/api/tprm/clients/roles").then(setRoles).catch(() => { });
        apiJson("/api/tprm/clients/employees").then(setEmployees).catch(() => { });
    }, []);

    // The dial defaults are the platform's, not this file's - the wizard opens
    // on whatever the methodology currently says, rather than on a copy of it
    // that drifts the first time somebody changes the seed.
    useEffect(() => {
        if (d.weights || !dims.length) return;
        const w = {};
        dims.forEach(x => { w[x.dimension_code] = Number(x.default_weight); });
        setD(x => ({ ...x, weights: w }));
    }, [dims, d.weights]);

    const sectorName = useMemo(() => {
        const s = sectors.find(x => x.sector_code === d.sector);
        return s ? s.sector_name : "";
    }, [sectors, d.sector]);

    const overlay = OVERLAY[sectorName] || OVERLAY_DEFAULT;
    // Memoised because the create handler closes over it: a fresh {} on every
    // render would rebuild that callback on every keystroke.
    const weights = useMemo(() => d.weights || {}, [d.weights]);
    const total = Object.values(weights).reduce((a, b) => a + Number(b), 0);
    const balanced = Math.abs(total - 1) < 0.001;
    const tiersOk = Number(d.t1) > Number(d.t2);

    // The intake template is step one of the pipeline and it goes to the
    // client, so a client with nobody to send it to is a client somebody has
    // to come back to. Insisted on here rather than at the point of sending.
    const contactOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.contactEmail.trim());

    const canNext =
        step === 0 ? Boolean(d.legal.trim() && /^[A-Z0-9]{2,8}$/.test(d.code) && d.sector
            && contactOk)
            : step === 2 ? balanced && tiersOk
                : true;

    const create = useCallback(async () => {
        setSaving(true);
        try {
            const r = await apiPost("/api/tprm/clients/create", {
                tenantName: d.legal.trim(),
                tradingName: d.trading.trim(),
                tenantCode: d.code,
                defaultSector: d.sector,
                context: {
                    secondarySectors: d.sec2, regions: d.regions, regulators: d.regs,
                    scaleBand: d.scale, dataTypes: d.dt, overlay,
                },
                weights,
                tier1: Number(d.t1),
                tier2: Number(d.t2),
                contactName: d.contactName.trim(),
                contactEmail: d.contactEmail.trim(),
                team: d.team.map(t => ({ empId: t.empId, roleCode: t.roleCode })),
            });
            await refetch();
            // First run ends here. Say what the new Practice Head can now do,
            // rather than leaving them to find it.
            if (setupMode) {
                tprmAlert.info(
                    "You are the Practice Head",
                    `${d.legal.trim()} is set up and you now hold every permission on it. `
                    + "Next: load suppliers from Third Parties, or add more of your team "
                    + "under Users and Roles.");
            } else {
                tprmAlert.success(d.team.length
                    ? `${d.legal.trim()} created, ${r.granted} on the team`
                    : `${d.legal.trim()} created`);
            }
            navigate("/Clients");
        } catch (e) {
            tprmAlert.apiError(e);
        } finally {
            setSaving(false);
        }
    }, [d, weights, overlay, navigate, refetch, setupMode]);

    const addMember = () => {
        const emp = employees.find(e => String(e.emp_id) === String(d.addEmp));
        if (!emp || d.team.some(t => String(t.empId) === String(d.addEmp))) return;
        setD(x => ({
            ...x,
            team: [...x.team, {
                empId: emp.emp_id, name: emp.emp_name, mail: emp.emp_mail_id, roleCode: x.addRole,
            }],
            addEmp: "",
        }));
    };

    const roleName = c => {
        const r = roles.find(x => x.role_code === c);
        return r ? r.role_name : c;
    };

    return (
        <div className="tprm-page">
            <h1 className="tprm-page-title">Onboard client</h1>
            <div className="tprm-page-sub" style={{ marginBottom: 22 }}>
                Five steps. Nothing is written until step five is confirmed.
            </div>

            {/* Completed steps are clickable; steps ahead are not. You can go
                back and change an answer, but you cannot skip past one. */}
            <div className="tprm-wz-steps">
                {STEPS.map((s, i) => (
                    <button
                        type="button"
                        key={s}
                        className={"tprm-wz-step" + (i === step ? " now" : i < step ? " done" : "")}
                        disabled={i >= step}
                        onClick={() => i < step && setStep(i)}
                    >
                        <span className="tprm-wz-bar" />
                        <span className="tprm-wz-steplabel">
                            {i < step ? "✓ " : i + 1 + ". "}{s}
                        </span>
                    </button>
                ))}
            </div>

            {step === 0 && (
                <div className="tprm-wz-cols">
                    <div className="tprm-card tprm-wz-main">
                        <div className="tprm-lab">Client identity</div>

                        <div className="tprm-field">
                            <label htmlFor="wz-legal">
                                Legal entity name <b className="req">*</b>
                            </label>
                            <input
                                id="wz-legal" className="tprm-input" value={d.legal}
                                placeholder="Petroleum Development Oman LLC"
                                onChange={e => set("legal", e.target.value)}
                            />
                            <div className="tprm-hint">Must be unique across all tenants</div>
                        </div>

                        <div className="tprm-field">
                            <label htmlFor="wz-trading">Trading name</label>
                            <input
                                id="wz-trading" className="tprm-input" value={d.trading}
                                placeholder="PDO"
                                onChange={e => set("trading", e.target.value)}
                            />
                            <div className="tprm-hint">
                                Used on reports where it differs from the legal entity
                            </div>
                        </div>

                        <div className="tprm-field">
                            <label htmlFor="wz-contact-name">Client contact</label>
                            <input
                                id="wz-contact-name" className="tprm-input" value={d.contactName}
                                placeholder="Ahmed Shaikh"
                                onChange={e => set("contactName", e.target.value)}
                            />
                            <div className="tprm-hint">
                                Who at the client this engagement runs through
                            </div>
                        </div>

                        <div className="tprm-field">
                            <label htmlFor="wz-contact-email">
                                Client contact email <b className="req">*</b>
                            </label>
                            <input
                                id="wz-contact-email" className="tprm-input" type="email"
                                value={d.contactEmail} placeholder="name@client.com"
                                onChange={e => set("contactEmail", e.target.value)}
                            />
                            <div className="tprm-hint">
                                Where the intake template, the tiering pack and issued reports are
                                sent. Held once here rather than retyped at every stage. This is not
                                a login - client users cannot sign in to dAssure.
                            </div>
                        </div>

                        <div className="tprm-field">
                            <label htmlFor="wz-code">
                                Client code <b className="req">*</b>
                            </label>
                            <input
                                id="wz-code" className="tprm-input tprm-wz-code" value={d.code}
                                placeholder="PDO" maxLength={8}
                                onChange={e => set("code",
                                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                            />
                            <div className="tprm-hint">
                                2 to 8 characters, uppercase. It appears in every document reference
                                we issue, so it cannot be changed later.
                            </div>
                        </div>

                        <div className="tprm-field">
                            <label htmlFor="wz-sector">
                                Primary sector <b className="req">*</b>
                            </label>
                            <TPRMSelect
                                id="wz-sector" value={d.sector} onChange={v => set("sector", v)}
                                placeholder="Select a sector" ariaLabel="Primary sector"
                                options={sectors.map(s => ({
                                    value: s.sector_code, label: s.sector_name,
                                }))}
                            />
                            <div className="tprm-hint">
                                The client's own industry. This drives the regulatory overlay.
                            </div>
                        </div>

                        <div className="tprm-lab">Secondary sectors, optional</div>
                        <div className="tprm-wz-chips">
                            {SECONDARY.map(s => (
                                <Toggle
                                    key={s} tone="blue" on={d.sec2.includes(s)}
                                    onClick={() => set("sec2", toggled(d.sec2, s))}
                                >
                                    {s}
                                </Toggle>
                            ))}
                        </div>
                    </div>

                    <div className="tprm-wz-side">
                        <div className="tprm-card tprm-wz-aside">
                            <div className="tprm-lab">The two sector rule</div>
                            <p className="tprm-wz-prose">
                                <b>This field is the client sector.</b> It sets the regulatory
                                overlay that every assessment for this client inherits.
                            </p>
                            <p className="tprm-wz-prose">
                                It does <b className="tprm-wz-no">not</b> decide which questionnaire
                                a vendor receives. That is chosen per third party, because a law firm
                                serving a power company still gets law firm questions.
                            </p>
                        </div>

                        {d.sector && (
                            <div className="tprm-card tprm-wz-overlay">
                                <div className="tprm-lab">Regulatory overlay resolved</div>
                                <div className="tprm-wz-overlaysub">
                                    Applied on top of every vendor instrument for{" "}
                                    {d.trading || d.legal || "this client"}
                                </div>
                                <div className="tprm-wz-chips">
                                    {overlay.map(o => (
                                        <span className="tprm-chip gold" key={o}>{o}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {step === 1 && (
                <div className="tprm-wz-cols">
                    <div className="tprm-card tprm-wz-main">
                        <div className="tprm-lab">Operating context</div>

                        <div className="tprm-wz-group">
                            <div className="tprm-lab">Operating regions</div>
                            <div className="tprm-wz-chips">
                                {REGIONS.map(r => (
                                    <Toggle
                                        key={r} tone="blue" on={d.regions.includes(r)}
                                        onClick={() => set("regions", toggled(d.regions, r))}
                                    >
                                        {r}
                                    </Toggle>
                                ))}
                            </div>
                        </div>

                        <div className="tprm-wz-group">
                            <div className="tprm-lab">Applicable regulators</div>
                            <div className="tprm-wz-chips">
                                {REGULATORS.map(r => (
                                    <Toggle
                                        key={r} tone="purple" on={d.regs.includes(r)}
                                        onClick={() => set("regs", toggled(d.regs, r))}
                                    >
                                        {r}
                                    </Toggle>
                                ))}
                            </div>
                        </div>

                        <div className="tprm-field">
                            <label htmlFor="wz-scale">Scale band</label>
                            <TPRMSelect
                                id="wz-scale" value={d.scale} onChange={v => set("scale", v)}
                                ariaLabel="Scale band"
                                options={SCALES.map(s => ({ value: s, label: s }))}
                            />
                            <div className="tprm-hint">
                                Drives default tiering sensitivity, not the questions themselves
                            </div>
                        </div>

                        <div className="tprm-wz-group">
                            <div className="tprm-lab">Data types in scope</div>
                            <div className="tprm-wz-chips">
                                {DATA_TYPES.map(r => (
                                    <Toggle
                                        key={r} tone="green" on={d.dt.includes(r)}
                                        onClick={() => set("dt", toggled(d.dt, r))}
                                    >
                                        {r}
                                    </Toggle>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="tprm-wz-side">
                        <div className="tprm-card tprm-wz-aside">
                            <div className="tprm-lab">Why this is captured now</div>
                            <p className="tprm-wz-prose">
                                Every vendor questionnaire issued for this client inherits this
                                context. A cloud host serving a power company in Oman receives cloud
                                questions carrying grid criticality and Oman CERT reporting duties.
                                The same cloud host serving a bank receives the same cloud questions
                                with a DORA overlay instead.
                            </p>
                            <p className="tprm-wz-prose">
                                Capture it wrong here and every Excel that lands on the client desk
                                is wrong.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="tprm-wz-cols">
                    <div className="tprm-card tprm-wz-main">
                        <div className="tprm-wz-headrow">
                            <div className="tprm-lab">Tiering dimension weights</div>
                            <span className={"tprm-chip " + (balanced ? "green" : "red")}>
                                {balanced ? "BALANCED 1.00" : "OUT OF BALANCE " + total.toFixed(2)}
                            </span>
                        </div>

                        {dims.map(x => (
                            <div className="tprm-wz-dial" key={x.dimension_code}>
                                <label htmlFor={"wz-w-" + x.dimension_code}>{x.dimension_name}</label>
                                <input
                                    id={"wz-w-" + x.dimension_code} type="range"
                                    min="0" max="0.5" step="0.01"
                                    value={weights[x.dimension_code] ?? 0}
                                    onChange={e => set("weights", {
                                        ...weights, [x.dimension_code]: Number(e.target.value),
                                    })}
                                />
                                <b className="mono">
                                    {Number(weights[x.dimension_code] ?? 0).toFixed(2)}
                                </b>
                            </div>
                        ))}

                        <div className="tprm-lab tprm-wz-spaced">Tier thresholds</div>
                        {[["t1", "Tier 1, Critical"], ["t2", "Tier 2, Significant"]].map(t => (
                            <div className="tprm-wz-dial" key={t[0]}>
                                <label htmlFor={"wz-" + t[0]}>{t[1]}, score at or above</label>
                                <input
                                    id={"wz-" + t[0]} type="range" min="1" max="3" step="0.05"
                                    value={d[t[0]]}
                                    onChange={e => set(t[0], Number(e.target.value))}
                                />
                                <b className="mono">{Number(d[t[0]]).toFixed(2)}</b>
                            </div>
                        ))}
                    </div>

                    <div className="tprm-wz-side">
                        <div className="tprm-card tprm-wz-sla-card">
                            <div className="tprm-lab">Remediation SLA, days</div>
                            {SLA_ROWS.map(s => (
                                <div className="tprm-wz-sla" key={s[0]}>
                                    <span className={"tprm-chip " + s[2]}>{s[0]}</span>
                                    <b className="mono">{s[1]}</b>
                                </div>
                            ))}
                        </div>

                        <div className={"tprm-note " + (balanced && tiersOk ? "blue" : "danger")}>
                            {!balanced
                                ? "Dimension weights must total exactly 1.00. Continue stays blocked until they do."
                                : !tiersOk
                                    ? "Tier 1 must sit above Tier 2. A supplier cannot be critical at a lower score than it is significant."
                                    : "Weights total 1.00 so this step can be completed. Tier 1 must remain above Tier 2, and that is enforced in the database as well as here."}
                        </div>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="tprm-wz-cols">
                    <div className="tprm-card tprm-wz-main">
                        <div className="tprm-lab">Internal team</div>

                        {d.team.map(t => (
                            <div className="tprm-wz-member" key={t.empId}>
                                <div className="tprm-wz-who">
                                    <div className="tprm-wz-name">{t.name}</div>
                                    <div className="mono tprm-wz-mail">{t.mail}</div>
                                </div>
                                <span className="tprm-chip purple">{roleName(t.roleCode)}</span>
                                <button
                                    type="button" className="tprm-linkbtn tprm-wz-remove"
                                    onClick={() => set("team", d.team.filter(x => x.empId !== t.empId))}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                        {d.team.length === 0 && (
                            <div className="tprm-empty">
                                Nobody added yet. You are on the client either way.
                            </div>
                        )}

                        <div className="tprm-wz-add">
                            <div className="tprm-field">
                                <label htmlFor="wz-emp">Add a colleague</label>
                                <TPRMSelect
                                    id="wz-emp" value={d.addEmp} onChange={v => set("addEmp", v)}
                                    placeholder="Search by name" ariaLabel="Add a colleague"
                                    /* Name on the line, address underneath. Both are
                                       searchable either way, and the closed control
                                       then shows a name rather than a name and an
                                       address fighting over one line. */
                                    options={employees
                                        .filter(e => !d.team.some(t => String(t.empId) === String(e.emp_id)))
                                        .map(e => ({
                                            value: String(e.emp_id),
                                            label: e.emp_name,
                                            hint: e.emp_mail_id,
                                        }))}
                                />
                            </div>
                            <div className="tprm-field role">
                                <label htmlFor="wz-role">Role</label>
                                <TPRMSelect
                                    id="wz-role" value={d.addRole} onChange={v => set("addRole", v)}
                                    ariaLabel="Role"
                                    options={roles
                                        .filter(r => !r.is_client_role && r.role_code !== "PH")
                                        .map(r => ({ value: r.role_code, label: r.role_name }))}
                                />
                            </div>
                            <button
                                type="button" className="tprm-btn" onClick={addMember}
                                disabled={!d.addEmp}
                            >
                                Add
                            </button>
                        </div>

                        <div className="tprm-note tprm-wz-spaced">
                            The role list shows only roles at or below your own rank, and the API
                            checks that again when the client is created. An Engagement Manager never
                            sees Practice Head here.
                        </div>
                    </div>

                    <div className="tprm-wz-side">
                        <div className="tprm-card tprm-wz-aside">
                            <div className="tprm-lab">How access works</div>
                            <ul className="tprm-wz-list">
                                <li>Named person only. Never a shared link or a shared password</li>
                                <li>
                                    Everyone here already has a Dolluz Corp account, so a role is
                                    granted rather than an invitation sent
                                </li>
                                <li>A role is scoped to this client alone, and to nothing else</li>
                                <li>Practice Head or Engagement Manager can revoke instantly</li>
                                <li>Every grant is written to the audit trail with who granted it</li>
                                <li>Nothing is written until step five is confirmed</li>
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {step === 4 && (
                <div className="tprm-wz-cols">
                    <div className="tprm-card tprm-wz-main">
                        <div className="tprm-lab">Review before creating</div>
                        {[
                            ["Legal entity", d.legal || "Not set", 0],
                            ["Trading name", d.trading || "Same as the legal entity", 0],
                            ["Client contact", d.contactName.trim()
                                ? `${d.contactName.trim()}, ${d.contactEmail.trim()}`
                                : d.contactEmail.trim() || "Not set", 0],
                            ["Client code", d.code || "Not set", 0],
                            ["Primary sector", sectorName || "Not set", 0],
                            ["Regulatory overlay", overlay.join(", "), 0],
                            ["Operating regions", d.regions.join(", ") || "None", 1],
                            ["Scale band", d.scale, 1],
                            ["Data types", d.dt.join(", ") || "None", 1],
                            ["Tier thresholds",
                                `Tier 1 at ${Number(d.t1).toFixed(2)}, Tier 2 at ${Number(d.t2).toFixed(2)}`,
                                2],
                            ["Team", d.team.length
                                ? `${d.team.length} ${d.team.length === 1 ? "person" : "people"}`
                                : "Just you", 3],
                        ].map(r => (
                            <div className="tprm-wz-review" key={r[0]}>
                                <div className="tprm-wz-rlabel">{r[0]}</div>
                                <div className="tprm-wz-rvalue">{r[1]}</div>
                                <button
                                    type="button" className="tprm-linkbtn"
                                    onClick={() => setStep(r[2])}
                                >
                                    Edit
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="tprm-wz-side">
                        <div className="tprm-card tprm-wz-create">
                            <div className="tprm-lab">What happens on create</div>
                            <ul className="tprm-wz-list">
                                <li>tenant row written, with the operating context</li>
                                <li>tenant_methodology written with the weights and thresholds</li>
                                <li>engagement roles granted for everyone named</li>
                                <li>audit events written for every one of the above</li>
                            </ul>
                            <div className="tprm-note blue tprm-wz-spaced">
                                All of it in one transaction. If any part fails the whole thing rolls
                                back, so a half created client is not possible.
                            </div>
                            <button
                                className="tprm-btn gold wide tprm-wz-spaced"
                                disabled={saving} onClick={create}
                            >
                                {saving ? "Creating..." : "Create client"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="tprm-wz-foot">
                <button
                    className="tprm-btn"
                    onClick={() => (step === 0 ? navigate("/Clients") : setStep(step - 1))}
                >
                    {step === 0 ? "Cancel" : "Back"}
                </button>
                <div className="tprm-wz-spacer" />
                {step < 4 && (
                    <button
                        className="tprm-btn primary" disabled={!canNext}
                        onClick={() => setStep(step + 1)}
                    >
                        Continue to {STEPS[step + 1]}
                    </button>
                )}
            </div>
        </div>
    );
}

export default TPRMClientWizard;
