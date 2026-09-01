// The dialog host. Mounted once, in App.js, above the router.
//
// Everything tprmAlert raises is rendered here. Two shapes:
//
//   toast   a success that dismisses itself after a moment. Bottom right, out
//           of the way, because it is a receipt rather than a question.
//   dialog  alert / confirm / reason. Centre, with a scrim.
//
// Dialogs stack, so an apiError raised while a confirm is open lands on top
// rather than being swallowed. Only the newest is interactive.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FaTimes, FaCheckCircle, FaExclamationTriangle, FaInfoCircle, FaTimesCircle } from "react-icons/fa";
import { subscribeToDialogs } from "./utils/tprmAlert";
import "./TPRM_Dialog.css";

const TOAST_MS = 2600;

const ICON = {
    success: FaCheckCircle,
    error: FaTimesCircle,
    warning: FaExclamationTriangle,
    info: FaInfoCircle,
};

function TPRMDialogHost() {
    const [items, setItems] = useState([]);
    const inputRef = useRef(null);
    const [draft, setDraft] = useState("");
    const [touched, setTouched] = useState(false);

    useEffect(() => subscribeToDialogs((item) => setItems(list => [...list, item])), []);

    /** Settle one dialog and take it off the stack. */
    const close = useCallback((item, value) => {
        item.resolve(value);
        setItems(list => list.filter(x => x.id !== item.id));
    }, []);

    const dialogs = items.filter(i => i.kind !== "toast");
    const toasts = items.filter(i => i.kind === "toast");
    const top = dialogs[dialogs.length - 1] || null;

    // A fresh dialog gets a fresh field. Without this the previous reason is
    // still sitting there when the next one opens.
    useEffect(() => {
        if (!top) return;
        setDraft(""); setTouched(false);
        if (top.kind === "reason") {
            const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 40);
            return () => clearTimeout(t);
        }
    }, [top && top.id]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Toasts retire themselves.
    useEffect(() => {
        if (!toasts.length) return;
        const timers = toasts.map(t => setTimeout(() => close(t, undefined), TOAST_MS));
        return () => timers.forEach(clearTimeout);
    }, [toasts.map(t => t.id).join(","), close]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Escape cancels, the same way it did before. A backdrop click does not:
    // several of these hold a typed reason that goes into the audit record,
    // and losing it to a stray click is the worst version of this interaction.
    useEffect(() => {
        if (!top) return;
        const onKey = (e) => {
            if (e.key === "Escape") close(top, top.kind === "reason" ? null : false);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && top.kind === "reason") submit();
            if (e.key === "Enter" && top.kind === "confirm") close(top, true);
            if (e.key === "Enter" && top.kind === "alert") close(top, undefined);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });   // no dep list: `submit` closes over the current draft

    const tooShort = top && top.kind === "reason"
        && draft.trim().length < (top.minLength || 10);

    const submit = () => {
        if (!top || top.kind !== "reason") return;
        if (tooShort) { setTouched(true); return; }
        close(top, draft.trim());
    };

    if (!items.length) return null;

    return (
        <>
            {toasts.length > 0 && (
                <div className="tprm-toasts">
                    {toasts.map(t => {
                        const Icon = ICON.success;
                        return (
                            <div className="tprm-toast" key={t.id} role="status">
                                <Icon className="tprm-toast-icon" />
                                <div className="tprm-toast-body">
                                    <div className="tprm-toast-title">{t.title}</div>
                                    {t.text && <div className="tprm-toast-text">{t.text}</div>}
                                </div>
                                <button
                                    className="tprm-toast-x"
                                    aria-label="Dismiss"
                                    onClick={() => close(t, undefined)}
                                ><FaTimes /></button>
                            </div>
                        );
                    })}
                </div>
            )}

            {dialogs.map((d, i) => {
                const Icon = ICON[d.tone] || ICON.info;
                const isTop = i === dialogs.length - 1;
                return (
                    <div
                        className={"tprm-dlg-backdrop" + (isTop ? "" : " behind")}
                        key={d.id}
                        aria-hidden={!isTop}
                    >
                        <div
                            className={"tprm-dlg tone-" + d.tone}
                            role={d.kind === "alert" ? "alertdialog" : "dialog"}
                            aria-modal="true"
                            aria-label={d.title}
                        >
                            <div className="tprm-dlg-head">
                                <span className={"tprm-dlg-icon tone-" + d.tone}><Icon /></span>
                                <div className="tprm-dlg-heading">
                                    <div className="tprm-dlg-title">{d.title}</div>
                                    {d.text && <div className="tprm-dlg-text">{d.text}</div>}
                                </div>
                            </div>

                            {/* A validation error arrives as a list of fields. Showing
                                them is the whole point - "that did not work" on its
                                own tells nobody which field to fix. */}
                            {d.details && d.details.length > 0 && (
                                <ul className="tprm-dlg-details">
                                    {d.details.map((x, n) => (
                                        <li key={n}>
                                            {x.field && <b>{x.field}: </b>}
                                            {x.message || String(x)}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {d.kind === "reason" && (
                                <div className="tprm-dlg-field">
                                    <label htmlFor="tprm-dlg-reason">{d.label}</label>
                                    <textarea
                                        id="tprm-dlg-reason"
                                        ref={inputRef}
                                        rows={4}
                                        className={"tprm-input" + (touched && tooShort ? " bad" : "")}
                                        value={draft}
                                        onChange={e => setDraft(e.target.value)}
                                    />
                                    <div className={"tprm-dlg-count" + (touched && tooShort ? " bad" : "")}>
                                        {tooShort
                                            ? `At least ${d.minLength} characters — this becomes part of the audit record. ${draft.trim().length} so far.`
                                            : `${draft.trim().length} characters. This becomes part of the audit record.`}
                                    </div>
                                </div>
                            )}

                            <div className="tprm-dlg-foot">
                                {d.kind === "alert" ? (
                                    <button className="tprm-btn primary" onClick={() => close(d, undefined)}>
                                        Close
                                    </button>
                                ) : d.kind === "confirm" ? (
                                    <>
                                        <button className="tprm-btn" onClick={() => close(d, false)}>Cancel</button>
                                        <button className="tprm-btn gold" onClick={() => close(d, true)}>
                                            {d.confirmText}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button className="tprm-btn" onClick={() => close(d, null)}>Cancel</button>
                                        <button className="tprm-btn gold" onClick={submit} disabled={tooShort}>
                                            Save
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </>
    );
}

export default TPRMDialogHost;
