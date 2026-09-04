import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiJson, apiPost, apiPut, apiUpload, apiDownload, apiDelete } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_AssessmentDetail.css";
import TPRMSelect from "./TPRM_Select";

const POSITIONS = [
    "Compliant", "Partially Compliant", "Non-Compliant", "Not Evidenced", "Not Applicable",
];

const POS_CLASS = {
    "Compliant": "green", "Partially Compliant": "amber", "Non-Compliant": "red",
    "Not Evidenced": "faint", "Not Applicable": "na",
};

/** Bytes as something a person can judge at a glance. */
const kb = (n) => {
    const b = Number(n) || 0;
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
    return (b / 1024 / 1024).toFixed(1) + " MB";
};

function TPRMAssessmentDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { hasPerm } = useAccess();
    const [d, setD] = useState(null);
    const [err, setErr] = useState(null);
    const [gate, setGate] = useState(null);
    // Which control's evidence list is open, and what has been fetched so far.
    const [openEvidence, setOpenEvidence] = useState(null);
    const [evidence, setEvidence] = useState({});
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    // Who can be assigned on this client, and what is currently picked.
    const [members, setMembers] = useState([]);
    const [assign, setAssign] = useState({ assessorId: "", reviewerId: "" });

    const load = useCallback(() => {
        apiJson(`/api/tprm/assessments/${id}`)
            .then(data => {
                setD(data);
                setAssign({
                    assessorId: data.assessment.assessor_id || "",
                    reviewerId: data.assessment.reviewer_id || "",
                });
                return data.assessment.tenant_id;
            })
            // Who may be assigned is a property of the client, so it can only be
            // asked for once the assessment has told us which client this is.
            .then(tenantId => apiJson(`/api/tprm/login/tenant-members/${tenantId}`))
            .then(setMembers)
            .catch(setErr);
    }, [id]);

    useEffect(() => { load(); }, [load]);

    if (err) return <div className="tprm-page"><div className="tprm-note danger">{err.message}</div></div>;
    if (!d) return <div className="tprm-loading">Loading the assessment...</div>;

    const a = d.assessment;
    const frozen = ["approved", "issued", "closed"].includes(a.state);
    const canOverride = hasPerm("response.override");

    const checkGate = async () => {
        try { setGate(await apiJson(`/api/tprm/assessments/${id}/submit-check`)); }
        catch (e) { tprmAlert.apiError(e); }
    };

    /* The submit checklist is a live answer to "can this go for review yet", so
       anything that could change one of its six rows has to refresh it as well
       as the assessment. Assigning a reviewer is exactly that case: the save
       reloaded the assessment underneath and left the checklist still showing
       the failure it had just fixed. Only refreshed while the checklist is on
       screen - no point asking the server a question nobody is looking at. */
    const reload = () => { load(); if (gate) checkGate(); };

    const saveAssignment = async () => {
        setBusy(true);
        try {
            await apiPut(`/api/tprm/assessments/${id}/assign`, {
                assessorId: assign.assessorId || null,
                reviewerId: assign.reviewerId || null,
            });
            reload();
            tprmAlert.success("Assignment saved");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const setHold = async (hold) => {
        let reason = null;
        if (hold) {
            reason = await tprmAlert.reason(
                "Put this case on hold",
                "Why is it stopping? The SLA clock pauses while it is held, and this becomes part of the audit record.");
            if (!reason) return;
        }
        setBusy(true);
        try {
            await apiPost(`/api/tprm/assessments/${id}/hold`, { hold, reason });
            reload();
            tprmAlert.success(hold ? "Case placed on hold" : "Case resumed");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };
    const byRef = {};
    d.responses.forEach(r => { byRef[r.q_ref] = r; });

    const controls = d.questions.filter(q =>
        q.q_type === "control" && (!a.tier || Number(q.tier_applies) >= Number(a.tier)));
    const tiering = d.questions.filter(q => q.q_type === "tiering");
    const pending = d.responses.filter(r => Number(r.vendor_asserted) === 1).length;
    const domains = [...new Set(controls.map(c => c.domain_code))];

    const run = async (fn, successMsg) => {
        setBusy(true);
        try {
            const r = await fn();
            if (successMsg) tprmAlert.success(successMsg);
            reload();
            return r;
        } catch (e) {
            tprmAlert.apiError(e);
        } finally {
            setBusy(false);
        }
    };

    const setPosition = (qRef, position) =>
        run(() => apiPost(`/api/tprm/assessments/${id}/responses`, { qRef, position }));

    const override = async (qRef, position) => {
        const justification = await tprmAlert.reason(
            "Override the supplier's answer",
            "Why are you changing this position? Fifteen characters minimum. This becomes part of the audit record and appears in the report.",
            15);
        if (!justification) return;
        run(() => apiPost(`/api/tprm/assessments/${id}/responses`,
            { qRef, position, override: true, justification }));
    };

    const setTiering = (qRef, score) =>
        run(() => apiPost(`/api/tprm/assessments/${id}/tiering`, { answers: [{ qRef, score }] }));

    const acceptArea = (domainCode) =>
        run(() => apiPost(`/api/tprm/assessments/${id}/accept-area`, { domainCode }));

    const raiseFindings = () =>
        run(() => apiPost(`/api/tprm/assessments/${id}/raise-findings`, {}), "Findings raised")
            .then(async () => {
                // They are tracked on Findings from here - due dates, severity,
                // remediation - so offer the way there rather than leaving
                // someone to find it.
                const go = await tprmAlert.confirm(
                    "Findings raised",
                    "They are tracked on the Findings screen from here, with a due date "
                    + "set from the severity. Go there now?",
                    "Open findings");
                if (go) navigate("/Findings");
            });

    const submit = () =>
        run(() => apiPost(`/api/tprm/assessments/${id}/submit`, {}), "Submitted for review")
            .then(() => {
                // Stay on the case. Being thrown back to the list gave no sign
                // that anything had happened beyond a toast that vanishes -
                // whereas the page itself now says "under review" in the header,
                // has dropped the editing controls, and shows Approve and Send
                // back to whoever is entitled to press them. Leaving is one
                // click away; proving the submit worked was not.
                setGate(null);
            });

    const approve = async () => {
        const ok = await tprmAlert.confirm(
            "Approve this assessment?",
            "Positions, scores and finding severities freeze permanently. A change after this needs a new assessment cycle.",
            "Yes, approve");
        if (ok) run(() => apiPost(`/api/tprm/assessments/${id}/approve`, {}), "Approved");
    };

    const sendBack = async () => {
        const reason = await tprmAlert.reason(
            "Send back for rework", "What needs to change before you would approve this?", 10);
        if (reason) run(() => apiPost(`/api/tprm/assessments/${id}/send-back`, { refs: [], reason }),
            "Sent back to the assessor");
    };

    const comment = () => {
        if (!draft.trim()) return;
        run(() => apiPost(`/api/tprm/assessments/${id}/messages`, { body: draft }))
            .then(() => setDraft(""));
    };

    const uploadEvidence = async (responseId, file) => {
        if (!file) return;
        await run(() => apiUpload(`/api/tprm/evidence/responses/${responseId}/upload`, file),
            "Evidence attached");
        // If the list is open behind the upload, refresh it rather than leave
        // it showing what was there a moment ago.
        if (openEvidence === responseId) loadEvidence(responseId, true);
    };

    /* The list is fetched per control, only when someone asks to see it. A
       register of thirty controls does not need thirty file listings loaded
       to render a count. */
    const loadEvidence = async (responseId, force) => {
        if (!force && evidence[responseId]) return;
        try {
            const files = await apiJson(`/api/tprm/evidence/responses/${responseId}/list`);
            setEvidence(prev => ({ ...prev, [responseId]: files }));
        } catch (e) { tprmAlert.apiError(e); }
    };

    const toggleEvidence = (responseId) => {
        setOpenEvidence(prev => {
            const next = prev === responseId ? null : responseId;
            if (next) loadEvidence(next);
            return next;
        });
    };

    const downloadEvidence = (f) =>
        apiDownload(`/api/tprm/evidence/${f.evidence_id}/download`, f.original_name)
            .catch(tprmAlert.apiError);

    /* Removing evidence changes what a control is scored on, so it is
       confirmed and it names the file - "are you sure" over an unnamed thing
       is not a question anyone can answer. */
    const removeEvidence = async (responseId, f) => {
        const ok = await tprmAlert.confirm(
            `Remove ${f.original_name}?`,
            "The file is deleted, not hidden. If this control was scored on it, "
            + "score it again once the right evidence is attached.",
            "Yes, remove it");
        if (!ok) return;
        try {
            await apiDelete(`/api/tprm/evidence/${f.evidence_id}`);
            tprmAlert.success("Evidence removed");
            await loadEvidence(responseId, true);
            load();
        } catch (e) { tprmAlert.apiError(e); }
    };

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <h1 className="tprm-page-title">{a.third_party_name}</h1>
                    <div className="tprm-page-sub">
                        {a.ref_code} &nbsp;|&nbsp; {a.sector_name} &nbsp;|&nbsp; Tier {a.tier || "-"}
                        &nbsp;|&nbsp; {a.tenant_name} &nbsp;|&nbsp; <b>{a.state.replace("_", " ")}</b>
                    </div>
                </div>
                <div className="tprm-page-actions">
                    <button className="tprm-btn" onClick={() => navigate("/Assessments")}>Back</button>
                    {!frozen && a.state === "in_progress" && hasPerm("finding.manage") && (
                        <button className="tprm-btn" onClick={raiseFindings} disabled={busy}>
                            Raise findings
                        </button>
                    )}
                    {!frozen && a.state === "in_progress" && (
                        <button className="tprm-btn gold" onClick={checkGate} disabled={busy}>
                            Submit for review
                        </button>
                    )}
                    {a.state === "in_progress" && hasPerm("assessment.hold") && (
                        <button className="tprm-btn" onClick={() => setHold(true)} disabled={busy}>
                            Put on hold
                        </button>
                    )}
                    {a.state === "on_hold" && hasPerm("assessment.hold") && (
                        <button className="tprm-btn primary" onClick={() => setHold(false)} disabled={busy}>
                            Resume
                        </button>
                    )}
                    {a.state === "under_review" && d.canApprove && !d.isAssessor && (
                        <>
                            <button className="tprm-btn" onClick={sendBack} disabled={busy}>Send back</button>
                            <button className="tprm-btn gold" onClick={approve} disabled={busy}>Approve</button>
                        </>
                    )}
                    {a.state === "under_review" && d.isAssessor && (
                        <span className="tprm-chip amber" style={{ alignSelf: "center" }}>
                            You assessed this, so you cannot approve it
                        </span>
                    )}
                    {frozen && hasPerm("report.generate") && (
                        <button
                            className="tprm-btn navy"
                            onClick={() => apiDownload(
                                `/api/tprm/reports/assessments/${id}/pdf`, "report.pdf")
                                .catch(e => tprmAlert.apiError(e))}
                        >
                            Download report
                        </button>
                    )}
                </div>
            </div>

            {pending > 0 && (
                <div className="tprm-note" style={{ marginBottom: 16 }}>
                    <b>Imported from the supplier pack.</b> {pending} controls are held as supplier
                    assertions until you accept them. Controls that came back with no evidence have
                    already dropped to Not Evidenced and score 1, automatically.
                </div>
            )}

            {a.state === "on_hold" && (
                <div className="tprm-note warn" style={{ marginBottom: 16 }}>
                    <b>On hold.</b> {a.hold_reason || "No reason was recorded."} The SLA clock on
                    every finding raised here is paused until the case resumes.
                </div>
            )}

            {/* Assignment. Hidden once the case is settled, because changing who
                assessed it after approval would rewrite history. */}
            {!frozen && hasPerm("assessment.assign") && (
                <div className="tprm-card tprm-assign" style={{ marginBottom: 18 }}>
                    <div className="tprm-card-head">
                        <div className="tprm-card-title">Assignment</div>
                    </div>
                    <div className="tprm-assign-grid">
                        <div className="tprm-field">
                            <label htmlFor="tprm-assessor">Assessor</label>
                            <TPRMSelect
                                id="tprm-assessor"
                                value={assign.assessorId}
                                onChange={v => setAssign(x => ({ ...x, assessorId: v }))}
                                placeholder="Nobody assigned"
                                ariaLabel="Assessor"
                                options={members.map(m => ({
                                    value: m.emp_id, label: m.emp_name, hint: m.role_name || m.role_code,
                                }))}
                            />
                        </div>
                        <div className="tprm-field">
                            <label htmlFor="tprm-reviewer">Reviewer</label>
                            {/* The assessor stays in the list but cannot be picked,
                                 so the separation-of-duties rule is visible rather
                                 than enforced by an absence. The database has a
                                 trigger for it either way. */}
                            <TPRMSelect
                                id="tprm-reviewer"
                                value={assign.reviewerId}
                                onChange={v => setAssign(x => ({ ...x, reviewerId: v }))}
                                placeholder="Nobody assigned"
                                ariaLabel="Reviewer"
                                options={members.map(m => ({
                                    value: m.emp_id,
                                    label: m.emp_name,
                                    hint: String(m.emp_id) === String(assign.assessorId)
                                        ? "already the assessor"
                                        : (m.role_name || m.role_code),
                                    disabled: String(m.emp_id) === String(assign.assessorId),
                                }))}
                            />
                            <div className="tprm-hint">
                                The reviewer cannot be the same person as the assessor
                            </div>
                        </div>
                        <div className="tprm-assign-save">
                            <button
                                className="tprm-btn primary"
                                onClick={saveAssignment}
                                disabled={busy
                                    || (String(assign.assessorId) === String(assign.reviewerId)
                                        && !!assign.assessorId)}
                            >
                                Save assignment
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="tprm-grid k5" style={{ marginBottom: 18 }}>
                {[
                    ["Inherent risk", a.inherent_score ?? "-", "var(--tprm-blue)",
                        a.tier ? `Tier ${a.tier}` : "not tiered"],
                    ["Effectiveness",
                        a.effectiveness == null ? "-" : Math.round(a.effectiveness * 100) + "%",
                        "var(--tprm-green)",
                        `${d.responses.filter(r => r.position).length} of ${controls.length} answered`],
                    ["Residual risk", a.residual_score ?? "-", "var(--tprm-red)", a.residual_band || ""],
                    ["Contradictions", d.flags.length, "var(--tprm-red)", "escalated, not scored"],
                    ["Awaiting you", pending, pending ? "var(--tprm-blue)" : "var(--tprm-green)",
                        "supplier assertions"],
                ].map(k => (
                    <div className="tprm-card tprm-kpi" key={k[0]} style={{ borderTopColor: k[2], padding: 15 }}>
                        <div className="tprm-kpi-label">{k[0]}</div>
                        <div className="tprm-kpi-value" style={{ color: k[2], fontSize: 24 }}>{k[1]}</div>
                        <div className="tprm-kpi-sub">{k[3]}</div>
                    </div>
                ))}
            </div>

            {gate && (
                <div className="tprm-card" style={{ marginBottom: 18 }}>
                    <div className="tprm-card-title" style={{ marginBottom: 12 }}>SUBMIT CHECKLIST</div>
                    {gate.map(c => (
                        <div className={"tprm-gate-row" + (c.pass ? "" : " fail")} key={c.key}>
                            <span className={"tprm-gate-dot " + (c.pass ? "ok" : "no")}>
                                {c.pass ? "✓" : "!"}
                            </span>
                            <div>
                                <div className="tprm-gate-label">{c.label}</div>
                                <div className="tprm-gate-detail">{c.detail}</div>
                            </div>
                        </div>
                    ))}
                    <div style={{ marginTop: 14, display: "flex", gap: 9 }}>
                        <button
                            className="tprm-btn primary"
                            onClick={submit}
                            disabled={busy || gate.some(c => !c.pass)}
                        >
                            Submit
                        </button>
                        <button className="tprm-btn" onClick={() => setGate(null)}>Close</button>
                    </div>
                </div>
            )}

            {d.flags.length > 0 && (
                <div className="tprm-card" style={{ marginBottom: 18, borderTop: "4px solid var(--tprm-red)" }}>
                    <div className="tprm-card-title" style={{ marginBottom: 12 }}>CONTRADICTION ENGINE</div>
                    {d.flags.map(f => (
                        <div className="tprm-note danger" key={f.flag_id} style={{ marginBottom: 8 }}>
                            <b>{f.refs_label}</b><br />{f.message}
                        </div>
                    ))}
                </div>
            )}

            <div className="tprm-detail-cols">
                <div className="tprm-detail-main">
                    {/* ------------------------------------------- tiering */}
                    {tiering.length > 0 && (
                        <div className="tprm-card flush" style={{ marginBottom: 16 }}>
                            <div className="tprm-card-head">
                                <div className="tprm-card-title">INHERENT RISK TIERING</div>
                                <div style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--tprm-muted)" }}>
                                    Answered by the client about the relationship
                                </div>
                            </div>
                            {tiering.map(q => {
                                const r = byRef[q.q_ref];
                                return (
                                    <div className="tprm-q" key={q.q_ref}>
                                        <div className="tprm-q-ref">{q.q_ref}</div>
                                        <div className="tprm-q-body">
                                            <div className="tprm-q-text">{q.q_text}</div>
                                            <div className="tprm-q-opts">
                                                {[1, 2, 3].map(s => (
                                                    <button
                                                        key={s}
                                                        className={"tprm-scorebtn"
                                                            + (r && Number(r.tiering_score) === s ? " on" : "")}
                                                        disabled={frozen || busy}
                                                        title={q[`score_${s}_label`] || ""}
                                                        onClick={() => setTiering(q.q_ref, s)}
                                                    >
                                                        {s}
                                                    </button>
                                                ))}
                                                <span className="tprm-q-hint">
                                                    {r && r.tiering_score
                                                        ? q[`score_${r.tiering_score}_label`]
                                                        : "Not answered"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ------------------------------------------ controls */}
                    {domains.map(dom => {
                        const cs = controls.filter(c => c.domain_code === dom);
                        const p = cs.filter(c => byRef[c.q_ref]
                            && Number(byRef[c.q_ref].vendor_asserted) === 1).length;
                        return (
                            <div className="tprm-card flush" key={dom} style={{ marginBottom: 16 }}>
                                <div className="tprm-card-head">
                                    <div className="tprm-card-title domain">
                                        {(cs[0] && cs[0].domain_name) || dom}
                                    </div>
                                    {p > 0 && !frozen && (
                                        <button
                                            className="tprm-btn sm primary"
                                            style={{ marginLeft: "auto" }}
                                            onClick={() => acceptArea(dom)}
                                            disabled={busy}
                                        >
                                            Accept {p} evidenced assertions
                                        </button>
                                    )}
                                </div>
                                {cs.map(q => {
                                    const r = byRef[q.q_ref];
                                    const asserted = r && Number(r.vendor_asserted) === 1;
                                    return (
                                        <div className={"tprm-q" + (asserted ? " asserted" : "")} key={q.q_ref}>
                                            <div className="tprm-q-ref">{q.q_ref}</div>
                                            <div className="tprm-q-body">
                                                <div className="tprm-q-text">{q.q_text}</div>
                                                {q.evidence_required && (
                                                    <div className="tprm-q-evidence">
                                                        Evidence expected: {q.evidence_required}
                                                    </div>
                                                )}
                                                {r && r.assessor_note && (
                                                    <div className="tprm-q-note">{r.assessor_note}</div>
                                                )}
                                                {r && Number(r.is_override) === 1 && (
                                                    <div className="tprm-q-override">
                                                        Overridden: {r.override_reason}
                                                    </div>
                                                )}

                                                <div className="tprm-q-opts">
                                                    {POSITIONS.map(p2 => {
                                                        /* Moving off what the supplier claimed is an
                                                           override, and that is a separate permission
                                                           from recording a position. Refusing on the
                                                           button says so before the round trip. */
                                                        const isOverride = asserted && r && r.position !== p2;
                                                        return (
                                                            <button
                                                                key={p2}
                                                                className={"tprm-posbtn " + POS_CLASS[p2]
                                                                    + (r && r.position === p2 ? " on" : "")}
                                                                disabled={frozen || busy
                                                                    || (isOverride && !canOverride)}
                                                                title={isOverride && !canOverride
                                                                    ? "Changing the supplier's own answer is an "
                                                                      + "override. Accept the assertion, or ask a "
                                                                      + "lead reviewer to overturn it."
                                                                    : undefined}
                                                                onClick={() => isOverride
                                                                    ? override(q.q_ref, p2)
                                                                    : setPosition(q.q_ref, p2)}
                                                            >
                                                                {p2}
                                                            </button>
                                                        );
                                                    })}
                                                </div>

                                                <div className="tprm-q-foot">
                                                    {/* The count was a dead label: it said a file
                                                        existed and gave you no way to see which,
                                                        check it was the right one, or take it back
                                                        off. It opens the list now. */}
                                                    {r && Number(r.evidence_count) > 0
                                                        ? (
                                                            <button
                                                                className={"tprm-chip green tprm-chip-btn"
                                                                    + (openEvidence === r.response_id ? " on" : "")}
                                                                onClick={() => toggleEvidence(r.response_id)}
                                                                title="See what is attached"
                                                            >
                                                                {r.evidence_count} evidence file
                                                                {Number(r.evidence_count) > 1 ? "s" : ""}
                                                                {openEvidence === r.response_id ? " ▴" : " ▾"}
                                                            </button>
                                                        )
                                                        : <span className="tprm-chip grey">no evidence</span>}
                                                    {asserted && (
                                                        <span className="tprm-chip amber">supplier assertion</span>
                                                    )}
                                                    {r && !frozen && hasPerm("evidence.manage") && (
                                                        <label className="tprm-upload">
                                                            Attach evidence
                                                            <input
                                                                type="file"
                                                                onChange={e => uploadEvidence(
                                                                    r.response_id, e.target.files[0])}
                                                            />
                                                        </label>
                                                    )}
                                                </div>

                                                {r && openEvidence === r.response_id && (
                                                    <div className="tprm-ev">
                                                        {!evidence[r.response_id] && (
                                                            <div className="tprm-ev-empty">Reading...</div>
                                                        )}
                                                        {(evidence[r.response_id] || []).map(f => (
                                                            <div className="tprm-ev-row" key={f.evidence_id}>
                                                                <div className="tprm-ev-main">
                                                                    <div className="tprm-ev-name">
                                                                        {f.original_name}
                                                                        {Number(f.expired) === 1 && (
                                                                            <span className="tprm-chip red"
                                                                                style={{ marginLeft: 8 }}>
                                                                                expired
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="tprm-ev-meta">
                                                                        {kb(f.byte_size)} &middot;{" "}
                                                                        {f.uploaded_by_name} &middot;{" "}
                                                                        {String(f.uploaded_time).slice(0, 10)}
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    className="tprm-btn sm"
                                                                    onClick={() => downloadEvidence(f)}
                                                                >
                                                                    Open
                                                                </button>
                                                                {!frozen && hasPerm("evidence.manage") && (
                                                                    <button
                                                                        className="tprm-btn sm danger"
                                                                        onClick={() => removeEvidence(r.response_id, f)}
                                                                    >
                                                                        Remove
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ))}
                                                        {evidence[r.response_id]
                                                            && evidence[r.response_id].length === 0 && (
                                                            <div className="tprm-ev-empty">
                                                                Nothing attached to this control.
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>

                {/* ------------------------------------------ case thread */}
                <div className="tprm-detail-side">
                    <div className="tprm-card flush">
                        <div className="tprm-card-head">
                            <div className="tprm-card-title">CASE THREAD</div>
                        </div>
                        <div className="tprm-thread">
                            {d.messages.length === 0 && (
                                <div className="tprm-empty" style={{ padding: 24 }}>
                                    Nothing yet. Discussion about this supplier belongs here rather
                                    than in a chat app.
                                </div>
                            )}
                            {d.messages.map(m => (
                                <div
                                    className={"tprm-msg" + (m.msg_kind === "activity" ? " activity" : "")}
                                    key={m.message_id}
                                >
                                    {m.msg_kind === "comment" && (
                                        <div className="tprm-msg-who">{m.author_name}</div>
                                    )}
                                    <div className="tprm-msg-body">{m.body}</div>
                                    <div className="tprm-msg-when">
                                        <span className="tprm-nowrap">
                                            {String(m.created_time).slice(0, 16).replace("T", " ")}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {hasPerm("case.comment") && (
                            <div className="tprm-thread-compose">
                                <textarea
                                    className="tprm-textarea"
                                    placeholder="Add a comment..."
                                    value={draft}
                                    onChange={e => setDraft(e.target.value)}
                                />
                                <button
                                    className="tprm-btn primary sm"
                                    onClick={comment}
                                    disabled={busy || !draft.trim()}
                                >
                                    Post
                                </button>
                            </div>
                        )}
                    </div>

                    {d.findings.length > 0 && (
                        <div className="tprm-card flush" style={{ marginTop: 16 }}>
                            <div className="tprm-card-head">
                                <div className="tprm-card-title">FINDINGS ({d.findings.length})</div>
                            </div>
                            {d.findings.map(f => (
                                <div className="tprm-finding" key={f.finding_id}>
                                    <div>
                                        <span className={"tprm-chip " + (
                                            f.severity === "Critical" ? "red"
                                                : f.severity === "High" ? "amber"
                                                    : f.severity === "Medium" ? "blue" : "grey")}>
                                            {f.severity}
                                        </span>
                                        <span className="num" style={{ marginLeft: 8, fontSize: 11.5 }}>
                                            {f.finding_ref}
                                        </span>
                                    </div>
                                    <div className="tprm-finding-title">{f.title}</div>
                                    <div className="tprm-finding-due">
                                        {f.control_ref} &nbsp;|&nbsp;{" "}
                                        <span className="tprm-nowrap">
                                            due {String(f.due_at).slice(0, 10)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default TPRMAssessmentDetail;
