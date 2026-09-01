// One question, as an editable table row.
//
// This replaces the add/edit modal. Authoring an instrument means writing
// thirty control questions in a sitting, and a modal per question is thirty
// opens and thirty closes for work that is really one long list. Editing in
// place means the row you are writing sits among the rows you already wrote,
// which is the only way to see whether the set hangs together.
//
// Saving a NEW row leaves a fresh blank row open behind it, so the rhythm is
// type, Enter, type, Enter - not type, save, find the button, click, type.
//
// Every field maps to a column the table already has, except the rationale,
// which is a slim second line under the question. It is the only field the
// supplier never sees, so it belongs subordinate to the one they do.

import React, { useEffect, useRef } from "react";
import { FaCheck, FaTimes } from "react-icons/fa";
import TPRMSelect from "./TPRM_Select";

export const TIER_CHOICES = [
    { value: 3, label: "All tiers", hint: "Every supplier answers it" },
    { value: 2, label: "Tier 1 and 2", hint: "Skipped for Tier 3" },
    { value: 1, label: "Tier 1 only", hint: "Only the most critical suppliers" },
];

export const blankQuestion = () => ({
    qRef: "", qText: "", dimensionCode: "", domainCode: "",
    score1: "", score2: "", score3: "", rationale: "",
    evidenceRequired: "", standardsMapping: "", tierApplies: 3,
});

export const questionToForm = (q) => ({
    qRef: q.q_ref || "",
    qText: q.q_text || "",
    dimensionCode: q.dimension_code || "",
    domainCode: q.domain_code || "",
    score1: q.score_1_label || "",
    score2: q.score_2_label || "",
    score3: q.score_3_label || "",
    rationale: q.rationale || "",
    evidenceRequired: q.evidence_required || "",
    standardsMapping: q.standards_mapping || "",
    tierApplies: Number(q.tier_applies) || 3,
});

/** Mirrors the server's shape rules, so Save is only live when it would be
 *  accepted: a tiering question is scored against a dimension, a control
 *  question against an area, and both need a reference and wording. */
export const rowReady = (qType, f) =>
    !!(f.qRef.trim() && f.qText.trim()
        && (qType === "tiering" ? f.dimensionCode : f.domainCode));

function QuestionEditRow({
    qType, form, setForm, dimensions, domains, onSave, onCancel, busy, isNew,
}) {
    const refInput = useRef(null);
    useEffect(() => { if (refInput.current) refInput.current.focus(); }, []);

    const set = (patch) => setForm(f => ({ ...f, ...patch }));
    const ready = rowReady(qType, form);

    // Enter saves from any single-line field. The question itself is a
    // textarea, where Enter has to mean a new line.
    const keys = (e) => {
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
            e.preventDefault();
            if (ready && !busy) onSave();
        }
    };

    const question = (
        <>
            <textarea
                className="tprm-input tprm-qrow-text"
                rows={2}
                value={form.qText}
                placeholder={qType === "tiering"
                    ? "What is the highest classification of our data the third party can access?"
                    : "Is multi factor authentication enforced for all remote and privileged access?"}
                onChange={e => set({ qText: e.target.value })}
                onKeyDown={keys}
            />
            <input
                className="tprm-input tprm-qrow-why"
                value={form.rationale}
                placeholder="Why we ask — kept for the assessor, never shown to the supplier"
                onChange={e => set({ rationale: e.target.value })}
                onKeyDown={keys}
            />
        </>
    );

    const actions = (
        <td>
            <div className="tprm-rowacts">
                <button
                    className="tprm-iconbtn solid"
                    title={ready ? (isNew ? "Add, and start another" : "Save") : "Reference, wording and a category are all needed"}
                    disabled={busy || !ready}
                    onClick={onSave}
                ><FaCheck /></button>
                <button className="tprm-iconbtn" title="Cancel" onClick={onCancel}>
                    <FaTimes />
                </button>
            </div>
        </td>
    );

    if (qType === "tiering") {
        return (
            <tr className="tprm-qrow">
                <td>
                    <input
                        ref={refInput}
                        className="tprm-input tprm-qrow-ref"
                        value={form.qRef}
                        placeholder="T01"
                        onChange={e => set({ qRef: e.target.value.toUpperCase() })}
                        onKeyDown={keys}
                    />
                </td>
                <td>
                    <TPRMSelect
                        value={form.dimensionCode}
                        onChange={v => set({ dimensionCode: v })}
                        placeholder="Dimension"
                        ariaLabel="Dimension"
                        options={dimensions.map(d => ({
                            value: d.dimension_code, label: d.dimension_name, hint: d.dimension_code,
                        }))}
                    />
                </td>
                <td>{question}</td>
                {[1, 2, 3].map(n => (
                    <td key={n}>
                        <input
                            className="tprm-input tprm-qrow-score"
                            value={form[`score${n}`]}
                            placeholder={["Public", "Internal", "Confidential"][n - 1]}
                            onChange={e => set({ [`score${n}`]: e.target.value })}
                            onKeyDown={keys}
                        />
                    </td>
                ))}
                {actions}
            </tr>
        );
    }

    return (
        <tr className="tprm-qrow">
            <td>
                <input
                    ref={refInput}
                    className="tprm-input tprm-qrow-ref"
                    value={form.qRef}
                    placeholder="GOV-01"
                    onChange={e => set({ qRef: e.target.value.toUpperCase() })}
                    onKeyDown={keys}
                />
            </td>
            <td>
                <TPRMSelect
                    value={form.domainCode}
                    onChange={v => set({ domainCode: v })}
                    placeholder="Control area"
                    ariaLabel="Control area"
                    options={domains.map(d => ({
                        value: d.domain_code, label: d.domain_name, hint: d.domain_code,
                    }))}
                />
            </td>
            <td>{question}</td>
            <td>
                <input
                    className="tprm-input"
                    value={form.evidenceRequired}
                    placeholder="Conditional access or MFA policy export"
                    onChange={e => set({ evidenceRequired: e.target.value })}
                    onKeyDown={keys}
                />
            </td>
            <td>
                <input
                    className="tprm-input"
                    value={form.standardsMapping}
                    placeholder="CIS Controls v8.1 6.3"
                    onChange={e => set({ standardsMapping: e.target.value })}
                    onKeyDown={keys}
                />
            </td>
            <td>
                <TPRMSelect
                    value={form.tierApplies}
                    onChange={v => set({ tierApplies: Number(v) })}
                    ariaLabel="Applies to"
                    options={TIER_CHOICES}
                />
            </td>
            {actions}
        </tr>
    );
}

export default QuestionEditRow;
