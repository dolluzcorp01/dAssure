import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiJson, apiPost, apiUpload, apiDownload } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_AssessmentDetail.css";

const POSITIONS = [
    "Compliant", "Partially Compliant", "Non-Compliant", "Not Evidenced", "Not Applicable",
];

const POS_CLASS = {
    "Compliant": "green", "Partially Compliant": "amber", "Non-Compliant": "red",
    "Not Evidenced": "grey", "Not Applicable": "grey",
};

function TPRMAssessmentDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, hasPerm } = useAccess();
    const [d, setD] = useState(null);
    const [err, setErr] = useState(null);
    const [gate, setGate] = useState(null);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        apiJson(`/api/tprm/assessments/${id}`).then(setD).catch(setErr);
    }, [id]);

    useEffect(() => { load(); }, [load]);

    if (err) return <div className="tprm-page"><div className="tprm-note danger">{err.message}</div></div>;
    if (!d) return <div className="tprm-loading">Loading the assessment...</div>;

    const a = d.assessment;
    const frozen = ["approved", "issued", "closed"].includes(a.state);
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
            load();
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
        run(() => apiPost(`/api/tprm/assessments/${id}/raise-findings`, {}), "Findings raised");

    const checkGate = async () => {
        try { setGate(await apiJson(`/api/tprm/assessments/${id}/submit-check`)); }
        catch (e) { tprmAlert.apiError(e); }
    };

    const submit = () =>
        run(() => apiPost(`/api/tprm/assessments/${id}/submit`, {}), "Submitted for review")
            .then(() => setGate(null));

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
        run(() => apiUpload(`/api/tprm/evidence/responses/${responseId}/upload`, file),
            "Evidence attached");
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
                        <button className="tprm-btn primary" onClick={checkGate} disabled={busy}>
                            Submit for review
                        </button>
                    )}
                    {a.state === "under_review" && d.canApprove && !d.isAssessor && (
                        <>
                            <button className="tprm-btn" onClick={sendBack} disabled={busy}>Send back</button>
                            <button className="tprm-btn primary" onClick={approve} disabled={busy}>Approve</button>
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
                        <div className="tprm-gate-row" key={c.key}>
                            <span className={"tprm-gate-dot " + (c.pass ? "ok" : "no")} />
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
                                    <div className="tprm-card-title">
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
                                                    {POSITIONS.map(p2 => (
                                                        <button
                                                            key={p2}
                                                            className={"tprm-posbtn " + POS_CLASS[p2]
                                                                + (r && r.position === p2 ? " on" : "")}
                                                            disabled={frozen || busy}
                                                            onClick={() => (asserted && r.position !== p2)
                                                                ? override(q.q_ref, p2)
                                                                : setPosition(q.q_ref, p2)}
                                                        >
                                                            {p2}
                                                        </button>
                                                    ))}
                                                </div>

                                                <div className="tprm-q-foot">
                                                    {r && Number(r.evidence_count) > 0
                                                        ? <span className="tprm-chip green">
                                                            {r.evidence_count} evidence file
                                                            {Number(r.evidence_count) > 1 ? "s" : ""}
                                                        </span>
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
                                        {String(m.created_time).slice(0, 16).replace("T", " ")}
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
                                        {f.control_ref} &nbsp;|&nbsp; due {String(f.due_at).slice(0, 10)}
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
