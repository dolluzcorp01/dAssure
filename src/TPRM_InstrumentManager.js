// Manage the instruments themselves - the values in the Question Bank picker.
//
// An instrument is a questionnaire the product can issue, so adding one is a
// bigger act than authoring a question, and it sits behind instrument.publish.
//
// The rule that shapes this screen: a code that has been used is never deleted.
// It is stamped into every supplier classified against it and into every
// document already issued, so removing it would orphan both. Disabling takes it
// out of the pickers and leaves the history intact - which is why Delete is
// only offered on an instrument nothing has touched yet.

import React, { useCallback, useEffect, useState } from "react";
import { FaTimes, FaPen, FaTrash, FaPlus } from "react-icons/fa";
import { apiJson, apiPost, apiPut, apiDelete } from "./utils/api";
import FilterPills from "./TPRM_FilterPills";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_InstrumentManager.css";

/* The three states this screen exists to sort out. Nothing authored yet is the
   one that needs real work; written but unpublished needs one click. */
const MATCH = {
    all: () => true,
    noq: r => !Number(r.questions),
    unpublished: r => Number(r.questions) > 0 && !Number(r.published_versions),
    ready: r => Number(r.published_versions) > 0,
};

function TPRMInstrumentManager({ open, onClose, onChanged }) {
    const [rows, setRows] = useState(null);
    const [busy, setBusy] = useState(false);
    const [adding, setAdding] = useState({ code: "", name: "", group: "" });
    const [editing, setEditing] = useState(null);   // { code, name, group }
    // "which ones still need questions written" is the reason this screen gets
    // opened, so it is a filter rather than something to scroll for.
    const [filter, setFilter] = useState("all");

    const load = useCallback(() => {
        apiJson("/api/tprm/library/sectors/manage")
            .then(setRows)
            .catch(e => { tprmAlert.apiError(e); setRows([]); });
    }, []);

    useEffect(() => { if (open) { load(); setEditing(null); setAdding({ code: "", name: "", group: "" }); } },
        [open, load]);

    if (!open) return null;

    const done = (msg) => { tprmAlert.success(msg); load(); onChanged && onChanged(); };

    const add = async () => {
        setBusy(true);
        try {
            await apiPost("/api/tprm/library/sectors", {
                sectorCode: adding.code, sectorName: adding.name,
                sectorGroup: adding.group || "Other",
            });
            setAdding({ code: "", name: "", group: "" });
            done("Instrument added");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const saveEdit = async () => {
        setBusy(true);
        try {
            await apiPut(`/api/tprm/library/sectors/${editing.code}`, {
                sectorName: editing.name, sectorGroup: editing.group,
            });
            setEditing(null);
            done("Instrument renamed");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const toggle = async (r) => {
        setBusy(true);
        try {
            await apiPut(`/api/tprm/library/sectors/${r.sector_code}/active`, { active: !r.active });
            done(r.active ? "Instrument disabled" : "Instrument enabled");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const remove = async (r) => {
        const ok = await tprmAlert.confirm(
            `Delete ${r.sector_name}?`,
            "Nothing has been classified into it and no version has been authored, so it can go without leaving anything behind.",
            "Yes, delete it");
        if (!ok) return;
        setBusy(true);
        try {
            await apiDelete(`/api/tprm/library/sectors/${r.sector_code}`);
            done("Instrument deleted");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const canAdd = /^[A-Za-z0-9]{2,24}$/.test(adding.code.trim()) && adding.name.trim();

    return (
        <div className="tprm-im-backdrop">
            <div className="tprm-im" role="dialog" aria-modal="true">
                <div className="tprm-im-head">
                    <div>
                        <div className="tprm-im-title">Manage instruments</div>
                        <div className="tprm-im-sub">
                            These fill the Question Bank picker and the Classify step. Renaming or
                            disabling one never changes a supplier already classified against it.
                        </div>
                    </div>
                    <button className="tprm-im-x" onClick={onClose} aria-label="Close"><FaTimes /></button>
                </div>

                <div className="tprm-im-body">
                    <div className="tprm-im-add">
                        <input
                            className="tprm-input" style={{ maxWidth: 130 }}
                            placeholder="CODE"
                            value={adding.code}
                            onChange={e => setAdding(a => ({ ...a, code: e.target.value.toUpperCase() }))}
                        />
                        <input
                            className="tprm-input"
                            placeholder="New instrument (e.g. Space and Satellite)"
                            value={adding.name}
                            onChange={e => setAdding(a => ({ ...a, name: e.target.value }))}
                        />
                        <input
                            className="tprm-input" style={{ maxWidth: 190 }}
                            placeholder="Group (optional)"
                            value={adding.group}
                            onChange={e => setAdding(a => ({ ...a, group: e.target.value }))}
                        />
                        <button className="tprm-btn gold" onClick={add} disabled={busy || !canAdd}>
                            <FaPlus style={{ marginRight: 6 }} />Add
                        </button>
                    </div>
                    <div className="tprm-hint" style={{ marginBottom: 14 }}>
                        The code is permanent — it appears in every document reference, so it cannot
                        be changed once the instrument exists. The name can.
                    </div>

                    {rows && (() => {
                        const n = k => rows.filter(r => MATCH[k](r)).length;
                        return (
                            <FilterPills
                                options={[
                                    { key: "all", label: "All", n: rows.length },
                                    { key: "noq", label: "No questions", n: n("noq") },
                                    { key: "unpublished", label: "Not published", n: n("unpublished") },
                                    { key: "ready", label: "Published", n: n("ready") },
                                ]}
                                value={filter}
                                onChange={setFilter}
                            />
                        );
                    })()}

                    {!rows && <div className="tprm-loading">Loading…</div>}

                    {rows && rows.filter(r => MATCH[filter](r)).length === 0 && (
                        <div className="tprm-empty">No instruments in this state.</div>
                    )}

                    {rows && rows.filter(r => MATCH[filter](r)).map(r => (
                        <div className="tprm-im-row" key={r.sector_code}>
                            {editing && editing.code === r.sector_code ? (
                                <>
                                    <span className="tprm-im-code mono">{r.sector_code}</span>
                                    <input
                                        className="tprm-input"
                                        value={editing.name}
                                        onChange={e => setEditing(x => ({ ...x, name: e.target.value }))}
                                    />
                                    <input
                                        className="tprm-input" style={{ maxWidth: 190 }}
                                        value={editing.group}
                                        onChange={e => setEditing(x => ({ ...x, group: e.target.value }))}
                                    />
                                    <button className="tprm-btn sm primary" onClick={saveEdit}
                                        disabled={busy || !editing.name.trim()}>Save</button>
                                    <button className="tprm-btn sm" onClick={() => setEditing(null)}>Cancel</button>
                                </>
                            ) : (
                                <>
                                    <span className="tprm-im-code mono">{r.sector_code}</span>
                                    <span className="tprm-im-name">{r.sector_name}</span>
                                    <span className="tprm-im-group">{r.sector_group}</span>
                                    {/* Says why Delete is or is not on offer, rather than
                                        leaving a disabled button with no explanation. */}
                                    <span className="tprm-im-use">
                                        {!Number(r.questions)
                                            ? "no questions"
                                            : r.in_use
                                                ? `${r.questions} questions · ${r.third_parties} supplier(s)`
                                                : `${r.questions} questions`}
                                    </span>
                                    <span className={"tprm-chip " + (r.active ? "green" : "grey")}>
                                        {r.active ? "ACTIVE" : "DISABLED"}
                                    </span>
                                    <button
                                        className="tprm-iconbtn"
                                        title="Rename"
                                        onClick={() => setEditing({
                                            code: r.sector_code, name: r.sector_name, group: r.sector_group,
                                        })}
                                    ><FaPen /></button>
                                    <button
                                        className="tprm-btn sm"
                                        disabled={busy}
                                        onClick={() => toggle(r)}
                                    >{r.active ? "Disable" : "Enable"}</button>
                                    <button
                                        className="tprm-iconbtn danger"
                                        title={r.in_use
                                            ? "In use — disable it instead, deleting would orphan issued documents"
                                            : "Delete"}
                                        disabled={busy || r.in_use}
                                        onClick={() => remove(r)}
                                    ><FaTrash /></button>
                                </>
                            )}
                        </div>
                    ))}
                </div>

                <div className="tprm-im-foot">
                    <button className="tprm-btn primary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
}

export default TPRMInstrumentManager;
