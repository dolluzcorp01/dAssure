import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPost } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_QuestionBank.css";

function TPRMQuestionBank() {
    const { hasPerm } = useAccess();
    const [sectors, setSectors] = useState([]);
    const [sector, setSector] = useState("GENERIC");
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        apiJson("/api/tprm/library/sectors").then(setSectors).catch(() => {});
    }, []);

    const load = useCallback(() => {
        if (!sector) return;
        setData(null);
        apiJson(`/api/tprm/library/instruments/${sector}`).then(setData).catch(() => setData(null));
    }, [sector]);

    useEffect(() => { load(); }, [load]);

    const newDraft = async () => {
        const note = await tprmAlert.reason(
            "Create a draft version", "What is changing in this version?", 5);
        if (!note) return;
        setBusy(true);
        try {
            await apiPost(`/api/tprm/library/instruments/${sector}/draft`, { changeNote: note });
            tprmAlert.success("Draft created", "Edit it, then publish when you are ready.");
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const publish = async (v) => {
        const ok = await tprmAlert.confirm(
            `Publish version ${v.version_no}?`,
            "The current published version retires. Assessments already under way keep the version they started on.",
            "Yes, publish");
        if (!ok) return;
        setBusy(true);
        try {
            const r = await apiPost(`/api/tprm/library/instruments/version/${v.instrument_version_id}/publish`, {});
            tprmAlert.success("Published", r.message);
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const tiering = data ? data.questions.filter(q => q.q_type === "tiering") : [];
    const controls = data ? data.questions.filter(q => q.q_type === "control") : [];

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <h1 className="tprm-page-title">Question bank</h1>
                    <div className="tprm-page-sub">
                        A published version is immutable. To change a question, create a draft,
                        edit it, and publish. Reports already issued never change underneath you.
                    </div>
                </div>
                <div className="tprm-page-actions">
                    <select
                        className="tprm-select" style={{ width: 230 }}
                        value={sector} onChange={e => setSector(e.target.value)}
                    >
                        {sectors.map(s => (
                            <option key={s.sector_code} value={s.sector_code}>
                                {s.sector_name} {s.published_versions ? "" : "(no published version)"}
                            </option>
                        ))}
                    </select>
                    {hasPerm("instrument.author") && (
                        <button className="tprm-btn" onClick={newDraft} disabled={busy}>
                            New draft version
                        </button>
                    )}
                </div>
            </div>

            {!data && <div className="tprm-loading">Loading...</div>}

            {data && data.versions.length === 0 && (
                <div className="tprm-note warn">
                    No instrument exists for this sector yet. Create a draft version to start one.
                    Until a version is published, suppliers in this sector cannot be assessed.
                </div>
            )}

            {data && data.versions.length > 0 && (
                <>
                    <div className="tprm-card flush" style={{ marginBottom: 18 }}>
                        <div className="tprm-card-head"><div className="tprm-card-title">VERSIONS</div></div>
                        <table className="tprm-table">
                            <thead>
                                <tr><th>Version</th><th>Status</th><th>Change note</th><th>Published</th><th></th></tr>
                            </thead>
                            <tbody>
                                {data.versions.map(v => (
                                    <tr key={v.instrument_version_id}>
                                        <td className="num" style={{ fontWeight: 700 }}>v{v.version_no}</td>
                                        <td>
                                            <span className={"tprm-chip " + (
                                                v.status === "published" ? "green"
                                                    : v.status === "draft" ? "amber" : "grey")}>
                                                {v.status}
                                            </span>
                                        </td>
                                        <td style={{ fontSize: 12, color: "var(--tprm-muted)" }}>
                                            {v.change_note || "-"}
                                        </td>
                                        <td style={{ fontSize: 12 }}>
                                            {v.published_time ? String(v.published_time).slice(0, 10) : "-"}
                                        </td>
                                        <td>
                                            {v.status === "draft" && hasPerm("instrument.publish") && (
                                                <button
                                                    className="tprm-btn sm primary"
                                                    onClick={() => publish(v)}
                                                    disabled={busy}
                                                >
                                                    Publish
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {data.standards.length > 0 && (
                        <div className="tprm-card" style={{ marginBottom: 18 }}>
                            <div className="tprm-card-title" style={{ marginBottom: 10 }}>
                                STANDARDS MAPPED IN v{data.current.version_no}
                            </div>
                            <div className="tprm-qb-standards">
                                {data.standards.map(s => (
                                    <span className="tprm-chip blue" key={s}>{s}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="tprm-card flush" style={{ marginBottom: 18 }}>
                        <div className="tprm-card-head">
                            <div className="tprm-card-title">
                                TIERING QUESTIONS ({tiering.length}) — answered by the client
                            </div>
                        </div>
                        <table className="tprm-table">
                            <thead>
                                <tr><th>Ref</th><th>Dimension</th><th>Question</th><th>1</th><th>2</th><th>3</th></tr>
                            </thead>
                            <tbody>
                                {tiering.map(q => (
                                    <tr key={q.question_id}>
                                        <td className="num" style={{ fontWeight: 700 }}>{q.q_ref}</td>
                                        <td style={{ fontSize: 12 }}>{q.dimension_name || q.dimension_code}</td>
                                        <td style={{ fontSize: 12.5, maxWidth: 340 }}>{q.q_text}</td>
                                        <td className="tprm-qb-scale">{q.score_1_label}</td>
                                        <td className="tprm-qb-scale">{q.score_2_label}</td>
                                        <td className="tprm-qb-scale">{q.score_3_label}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="tprm-card flush">
                        <div className="tprm-card-head">
                            <div className="tprm-card-title">
                                CONTROL QUESTIONS ({controls.length}) — answered by the supplier
                            </div>
                        </div>
                        <table className="tprm-table">
                            <thead>
                                <tr>
                                    <th>Ref</th><th>Control area</th><th>Question</th>
                                    <th>Evidence expected</th><th>Standard</th><th>Applies to</th>
                                </tr>
                            </thead>
                            <tbody>
                                {controls.map(q => (
                                    <tr key={q.question_id}>
                                        <td className="num" style={{ fontWeight: 700 }}>{q.q_ref}</td>
                                        <td style={{ fontSize: 12 }}>{q.domain_name || q.domain_code}</td>
                                        <td style={{ fontSize: 12.5, maxWidth: 320 }}>{q.q_text}</td>
                                        <td style={{ fontSize: 11.5, color: "var(--tprm-muted)", maxWidth: 220 }}>
                                            {q.evidence_required}
                                        </td>
                                        <td style={{ fontSize: 11, color: "var(--tprm-faint)" }}>
                                            {q.standards_mapping}
                                        </td>
                                        <td>
                                            <span className="tprm-chip grey">
                                                {Number(q.tier_applies) === 1 ? "Tier 1"
                                                    : Number(q.tier_applies) === 2 ? "Tier 1-2" : "All tiers"}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

export default TPRMQuestionBank;
