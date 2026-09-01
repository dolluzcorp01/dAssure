// Login banners.
//
// Edited in place: change a cell and the Save on that row lights up. The
// preview strip above renders the selected row exactly as the sign-in panel
// does, so someone picking a gradient can see the result without signing out
// to check it.

import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPost, apiPut, apiDelete } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_Banners.css";

const BLANK = {
    tagLabel: "", headline: "", subline: "",
    gradientFrom: "#0D1B2A", gradientTo: "#16334F",
};

// The same declaration the sign-in panel uses, so the preview is not an
// approximation of it.
const gradientOf = (from, to) =>
    `linear-gradient(150deg, ${from || "#0D1B2A"} 0%, ${to || "#16334F"} 100%)`;

const toForm = (b) => ({
    tagLabel: b.tag_label || "", headline: b.headline || "", subline: b.subline || "",
    gradientFrom: b.gradient_from, gradientTo: b.gradient_to,
    sortOrder: b.sort_order, active: !!b.active,
});

function TPRMBanners() {
    const { hasPerm } = useAccess();
    const may = hasPerm("banner.manage");

    const [rows, setRows] = useState(null);
    const [draft, setDraft] = useState({});      // banner_id -> the edited copy
    const [selected, setSelected] = useState(null);
    const [adding, setAdding] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => apiJson("/api/tprm/banners")
        .then(list => {
            setRows(list);
            setDraft(Object.fromEntries(list.map(b => [b.banner_id, toForm(b)])));
            setSelected(s => (s && list.some(b => b.banner_id === s)
                ? s : (list[0] || {}).banner_id));
        })
        .catch(e => { tprmAlert.apiError(e); setRows([]); }), []);

    useEffect(() => { load(); }, [load]);

    const set = (id, patch) => setDraft(d => ({ ...d, [id]: { ...d[id], ...patch } }));

    // Save is only offered when something actually changed on that row.
    const dirty = (b) => {
        const d = draft[b.banner_id];
        if (!d) return false;
        const o = toForm(b);
        return Object.keys(o).some(k => String(o[k]) !== String(d[k]));
    };

    /* Whether a banner is live is not the same kind of thing as its wording.
       The text is drafted and saved deliberately; being live is a switch, and a
       switch that needs a separate Save is a switch people get wrong. This one
       applies immediately and reloads, so the list always shows the truth -
       including the server refusing to take the last active banner down. */
    const toggleActive = async (b) => {
        setBusy(true);
        try {
            await apiPut(`/api/tprm/banners/${b.banner_id}`,
                { ...draft[b.banner_id], active: !b.active });
            await load();
            tprmAlert.success(b.active ? "Banner deactivated" : "Banner activated");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const save = async (b) => {
        setBusy(true);
        try {
            await apiPut(`/api/tprm/banners/${b.banner_id}`, draft[b.banner_id]);
            await load();
            tprmAlert.success("Banner saved");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const remove = async (b) => {
        const ok = await tprmAlert.confirm(
            "Delete this banner?",
            `"${b.headline}" will be removed from the sign-in screen.`,
            "Yes, delete it");
        if (!ok) return;
        setBusy(true);
        try {
            await apiDelete(`/api/tprm/banners/${b.banner_id}`);
            await load();
            tprmAlert.success("Banner deleted");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const add = async () => {
        setBusy(true);
        try {
            await apiPost("/api/tprm/banners", adding);
            setAdding(null);
            await load();
            tprmAlert.success("Banner added");
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    if (!rows) return <div className="tprm-loading">Loading banners...</div>;

    // The preview follows the row being added, or the selected row as edited.
    const shown = adding
        || (selected != null && draft[selected])
        || (rows[0] && toForm(rows[0]))
        || BLANK;

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <div className="tprm-page-sub">
                        The rotating panel on the sign-in screen. Each banner carries its own
                        gradient, so the panels do not all look alike. Edits are live at the
                        next sign-in.
                    </div>
                </div>
                {may && (
                    <div className="tprm-page-actions">
                        <button className="tprm-btn primary" onClick={() => setAdding({ ...BLANK })}>
                            Add banner
                        </button>
                    </div>
                )}
            </div>

            <div
                className="tprm-banner-preview"
                style={{ background: gradientOf(shown.gradientFrom, shown.gradientTo) }}
            >
                <div className="tprm-banner-previewtag">{shown.tagLabel || " "}</div>
                <div className="tprm-banner-previewhead">{shown.headline || "Your headline"}</div>
                <div className="tprm-banner-previewsub">{shown.subline}</div>
            </div>

            {adding && (
                <div className="tprm-card tprm-banner-add">
                    <div className="tprm-banner-addgrid">
                        <div className="tprm-field">
                            <label>Tag label</label>
                            <input
                                className="tprm-input" maxLength={40} autoFocus
                                value={adding.tagLabel}
                                onChange={e => setAdding({ ...adding, tagLabel: e.target.value })}
                                placeholder="EVIDENCE"
                            />
                        </div>
                        <div className="tprm-field">
                            <label>Headline</label>
                            <input
                                className="tprm-input" maxLength={160}
                                value={adding.headline}
                                onChange={e => setAdding({ ...adding, headline: e.target.value })}
                            />
                        </div>
                        <div className="tprm-field narrow">
                            <label>From</label>
                            <input
                                type="color" className="tprm-color" value={adding.gradientFrom}
                                onChange={e => setAdding({
                                    ...adding, gradientFrom: e.target.value.toUpperCase() })}
                            />
                        </div>
                        <div className="tprm-field narrow">
                            <label>To</label>
                            <input
                                type="color" className="tprm-color" value={adding.gradientTo}
                                onChange={e => setAdding({
                                    ...adding, gradientTo: e.target.value.toUpperCase() })}
                            />
                        </div>
                    </div>
                    <div className="tprm-field">
                        <label>Subline</label>
                        <textarea
                            className="tprm-textarea" maxLength={400} value={adding.subline}
                            onChange={e => setAdding({ ...adding, subline: e.target.value })}
                        />
                    </div>
                    <div className="tprm-banner-addfoot">
                        <button className="tprm-btn" onClick={() => setAdding(null)} disabled={busy}>
                            Cancel
                        </button>
                        <button
                            className="tprm-btn gold"
                            onClick={add}
                            disabled={busy || !adding.headline.trim()}
                        >
                            {busy ? "Saving..." : "Add banner"}
                        </button>
                    </div>
                </div>
            )}

            <div className="tprm-card flush" style={{ overflowX: "auto" }}>
                <table className="tprm-table tprm-banner-table">
                    <thead>
                        <tr>
                            <th>Tag label</th>
                            <th>Headline</th>
                            <th>Subline</th>
                            <th className="num">From</th>
                            <th className="num">To</th>
                            <th className="num">Order</th>
                            <th>Status</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(b => {
                            const d = draft[b.banner_id] || toForm(b);
                            const changed = dirty(b);
                            return (
                                <tr
                                    key={b.banner_id}
                                    className={selected === b.banner_id ? "selected" : ""}
                                    onFocusCapture={() => setSelected(b.banner_id)}
                                    onClick={() => setSelected(b.banner_id)}
                                >
                                    <td>
                                        <input
                                            className="tprm-input sm" maxLength={40} disabled={!may}
                                            value={d.tagLabel}
                                            onChange={e => set(b.banner_id, { tagLabel: e.target.value })}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="tprm-input sm" maxLength={160} disabled={!may}
                                            value={d.headline}
                                            onChange={e => set(b.banner_id, { headline: e.target.value })}
                                        />
                                    </td>
                                    <td>
                                        <textarea
                                            className="tprm-textarea sm" maxLength={400} disabled={!may}
                                            value={d.subline}
                                            onChange={e => set(b.banner_id, { subline: e.target.value })}
                                        />
                                    </td>
                                    <td className="num">
                                        <input
                                            type="color" className="tprm-color" disabled={!may}
                                            value={d.gradientFrom}
                                            onChange={e => set(b.banner_id, {
                                                gradientFrom: e.target.value.toUpperCase() })}
                                        />
                                    </td>
                                    <td className="num">
                                        <input
                                            type="color" className="tprm-color" disabled={!may}
                                            value={d.gradientTo}
                                            onChange={e => set(b.banner_id, {
                                                gradientTo: e.target.value.toUpperCase() })}
                                        />
                                    </td>
                                    <td className="num">
                                        <input
                                            type="number" className="tprm-input sm order" disabled={!may}
                                            value={d.sortOrder}
                                            onChange={e => set(b.banner_id, { sortOrder: e.target.value })}
                                        />
                                    </td>
                                    <td>
                                        <div className="tprm-banner-state">
                                            <span className={"tprm-chip " + (b.active ? "green" : "grey")}>
                                                {b.active ? "ACTIVE" : "INACTIVE"}
                                            </span>
                                            {may && (
                                                <button
                                                    className="tprm-btn sm"
                                                    disabled={busy}
                                                    onClick={() => toggleActive(b)}
                                                >
                                                    {b.active ? "Deactivate" : "Activate"}
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    <td className="tprm-banner-rowactions">
                                        {may && (
                                            <>
                                                <button
                                                    className="tprm-btn sm primary"
                                                    disabled={busy || !changed}
                                                    onClick={() => save(b)}
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    className="tprm-btn sm"
                                                    disabled={busy}
                                                    onClick={() => remove(b)}
                                                >
                                                    Delete
                                                </button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        {rows.length === 0 && (
                            <tr><td colSpan={8} className="tprm-empty">
                                No banners. The sign-in screen falls back to its built-in copy
                                until you add one.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="tprm-note" style={{ marginTop: 16 }}>
                At least one banner must stay active. The last active one cannot be deactivated
                or deleted, because the sign-in screen would have nothing to show.
            </div>
        </div>
    );
}

export default TPRMBanners;
