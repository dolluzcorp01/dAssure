// The mail preview + send modal.
//
// Nothing in dTPRM sends an email that could not be looked at first, and this
// is the one component that shows it. It is deliberately generic - it takes the
// two endpoint URLs and a send handler - so every screen with a send button
// gets the same modal rather than growing its own.
//
// Two gestures, kept separate on purpose:
//   ticking a row  decides who receives the mail
//   clicking a row previews that person's mail
// Overloading one gesture onto the other is how people send to the wrong list.
//
// The heavy HTML is fetched one recipient at a time and cached. A fifty
// supplier run costs one roster call plus one render per email actually opened,
// not fifty renders nobody reads.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaTimes, FaPaperPlane, FaSearch } from "react-icons/fa";
import { apiJson } from "./utils/api";
import "./TPRM_MailPreview.css";

function TPRMMailPreview({
    open,
    title,
    subtitle,
    rosterUrl,
    previewUrl,
    ids,                 // optional: restrict the roster to these record ids
    idKey = "id",        // the body key the preview endpoint expects
    rosterKey = "ids",   // the body key the roster endpoint expects
    previewOnly = false,
    extraPreviewBody,    // e.g. { reminder: true }
    onSend,              // async (checkedIds) => { sent, failed, skipped }
    onClose,
}) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [recipients, setRecipients] = useState([]);
    const [counts, setCounts] = useState({});
    const [checked, setChecked] = useState([]);
    const [index, setIndex] = useState(0);
    const [previews, setPreviews] = useState({});
    const [previewLoading, setPreviewLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState(null);
    const [filter, setFilter] = useState("");
    const [jumpOpen, setJumpOpen] = useState(false);
    // previews is read inside a callback that must not re-run when it changes,
    // so the cache check goes through a ref rather than the dependency list.
    const cacheRef = useRef({});

    /* ---------------------------------------------------- one recipient */
    const loadPreview = useCallback(async (i, list) => {
        const roster = list || recipients;
        const r = roster[i];
        if (!r) return;
        setIndex(i);
        if (cacheRef.current[r.id]) return;      // already rendered

        setPreviewLoading(true);
        try {
            const data = await apiJson(previewUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [idKey]: r.id, ...(extraPreviewBody || {}) }),
            });
            cacheRef.current[r.id] = data;
            setPreviews({ ...cacheRef.current });
        } catch (e) {
            cacheRef.current[r.id] = { error: e.message || "Could not render this email." };
            setPreviews({ ...cacheRef.current });
        } finally {
            setPreviewLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recipients, previewUrl, idKey]);

    /* --------------------------------------------------------- the roster */
    useEffect(() => {
        if (!open) return;
        let live = true;
        setLoading(true); setError(null); setResult(null);
        cacheRef.current = {}; setPreviews({}); setIndex(0); setFilter("");

        apiJson(rosterUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ids && ids.length ? { [rosterKey]: ids } : {}),
        })
            .then(data => {
                if (!live) return;
                const list = data.recipients || [];
                setRecipients(list);
                setCounts({
                    sendable: data.sendable_count || 0,
                    noEmail: data.no_email_count || 0,
                    notEligible: data.not_eligible_count || 0,
                });
                // Everyone eligible starts ticked. The button says "all", so that
                // is the default; narrowing is a matter of unticking.
                setChecked(list.filter(r => r.sendable).map(r => r.id));
                setLoading(false);
                if (list.length) loadPreview(0, list);
            })
            .catch(e => { if (live) { setError(e.message || "Could not build the list."); setLoading(false); } });

        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, rosterUrl]);

    /* ------------------------------------------------------------ helpers */
    const visible = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return recipients;
        return recipients.filter(r =>
            [r.name, r.record_no, r.to, r.department].filter(Boolean)
                .some(v => String(v).toLowerCase().includes(q)));
    }, [recipients, filter]);

    // Only sendable rows can ever be ticked, so this is also the send count.
    const sendableChecked = useMemo(
        () => checked.filter(id => recipients.find(r => r.id === id)?.sendable),
        [checked, recipients]);

    const toggle = (id) => {
        const r = recipients.find(x => x.id === id);
        if (!r || !r.sendable) return;          // never tickable
        setChecked(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);
    };

    const toggleAllVisible = () => {
        const vis = visible.filter(r => r.sendable).map(r => r.id);
        const allOn = vis.every(id => checked.includes(id));
        setChecked(c => allOn ? c.filter(id => !vis.includes(id))
            : [...new Set([...c, ...vis])]);
    };

    const step = (delta) => {
        const next = index + delta;
        if (next < 0 || next >= recipients.length) return;
        loadPreview(next);
    };

    const send = async () => {
        if (!onSend || !sendableChecked.length) return;
        setSending(true);
        try {
            setResult(await onSend(sendableChecked));
        } catch (e) {
            setResult({ error: e.message || "The send failed." });
        } finally {
            setSending(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        const esc = (e) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", esc);
        return () => window.removeEventListener("keydown", esc);
    }, [open, onClose]);

    if (!open) return null;

    const rcpt = recipients[index];
    const prev = rcpt ? previews[rcpt.id] : null;
    // One recipient needs no filters, no checklist and no pager - a one-row
    // "select all" and a pager reading "1 of 1" are just noise.
    const many = recipients.length > 1;

    return (
        // No overlay onClick. Losing a half-configured recipient list to a stray
        // click outside the dialog is infuriating; the X and Cancel are the ways out.
        <div className="tprm-mp-backdrop">
            <div className="tprm-mp" role="dialog" aria-modal="true" aria-label={title}>
                <div className="tprm-mp-head">
                    <div>
                        <div className="tprm-mp-title">{title}</div>
                        <div className="tprm-mp-sub">
                            {loading ? "Building the list..."
                                : subtitle || (many
                                    ? `${recipients.length} recipients · ${counts.sendable} will be sent`
                                        + (counts.noEmail ? ` · ${counts.noEmail} without an email` : "")
                                    : rcpt ? rcpt.name : "")}
                        </div>
                    </div>
                    <button className="tprm-mp-x" onClick={onClose} aria-label="Close"><FaTimes /></button>
                </div>

                <div className="tprm-mp-body">
                    {error && <div className="tprm-note danger">{error}</div>}

                    {!loading && !error && recipients.length === 0 && (
                        <div className="tprm-empty">Nobody to send to.</div>
                    )}

                    {many && !previewOnly && (
                        <div className="tprm-mp-picker">
                            <div className="tprm-mp-pickerhead">
                                <label className="tprm-mp-all">
                                    <input
                                        type="checkbox"
                                        checked={visible.filter(r => r.sendable).length > 0
                                            && visible.filter(r => r.sendable).every(r => checked.includes(r.id))}
                                        onChange={toggleAllVisible}
                                    />
                                    Select all shown
                                </label>
                                <div className="tprm-mp-search">
                                    <FaSearch />
                                    <input
                                        value={filter}
                                        placeholder="Filter by name, ref or address"
                                        onChange={e => setFilter(e.target.value)}
                                    />
                                </div>
                                <span className="tprm-mp-willsend">{sendableChecked.length} will be sent</span>
                            </div>
                            <div className="tprm-mp-list">
                                {visible.map(r => {
                                    const i = recipients.indexOf(r);
                                    return (
                                        <div
                                            key={r.id}
                                            className={"tprm-mp-row"
                                                + (i === index ? " previewing" : "")
                                                + (r.sendable ? "" : " blocked")}
                                            onClick={() => loadPreview(i)}
                                        >
                                            <input
                                                type="checkbox"
                                                disabled={!r.sendable}
                                                checked={checked.includes(r.id)}
                                                onChange={() => toggle(r.id)}
                                                onClick={e => e.stopPropagation()}
                                            />
                                            <span className="tprm-mp-name">{r.name}</span>
                                            <span className="tprm-mp-ref mono">{r.record_no || ""}</span>
                                            <span className="tprm-mp-period">{r.period_label || ""}</span>
                                            {!r.sendable && (
                                                <span className="tprm-chip grey">{r.skip_reason || "not eligible"}</span>
                                            )}
                                            {i === index && <span className="tprm-mp-mark">previewing</span>}
                                        </div>
                                    );
                                })}
                                {visible.length === 0 && (
                                    <div className="tprm-empty">Nothing matches that filter.</div>
                                )}
                            </div>
                        </div>
                    )}

                    {many && (
                        <div className="tprm-mp-pager">
                            <button className="tprm-btn sm" disabled={index === 0} onClick={() => step(-1)}>‹</button>
                            <span className="tprm-mp-pagerlabel">
                                Recipient {index + 1} of {recipients.length}
                            </span>
                            <div className="tprm-mp-jump">
                                <button className="tprm-btn sm" onClick={() => setJumpOpen(o => !o)}>
                                    Jump to… ▾
                                </button>
                                {jumpOpen && (
                                    <div className="tprm-mp-jumpmenu">
                                        {recipients.map((r, i) => (
                                            <button
                                                key={r.id}
                                                className={i === index ? "on" : ""}
                                                onClick={() => { setJumpOpen(false); loadPreview(i); }}
                                            >
                                                {r.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <button
                                className="tprm-btn sm"
                                disabled={index >= recipients.length - 1}
                                onClick={() => step(1)}
                            >›</button>
                        </div>
                    )}

                    {rcpt && !rcpt.sendable && (
                        <div className="tprm-note warn" style={{ marginBottom: 12 }}>
                            {rcpt.skip_reason === "no email"
                                ? <>No email address on file for <b>{rcpt.name}</b> — this one will be skipped.</>
                                : <>{rcpt.name} is <b>{rcpt.status}</b> — it will be skipped.</>}
                        </div>
                    )}

                    {previewLoading && !prev ? (
                        <div className="tprm-loading">Rendering {rcpt ? rcpt.name : ""}'s email…</div>
                    ) : prev?.error ? (
                        <div className="tprm-note danger">{prev.error}</div>
                    ) : prev ? (
                        <>
                            <div className="tprm-mp-meta">
                                <div><span>From</span><b>{prev.from}</b></div>
                                <div><span>To</span><b>
                                    {prev.to || <em className="tprm-mp-noemail">No email on file</em>}
                                </b></div>
                                <div><span>Cc</span><b>{(prev.cc || []).join(", ") || "—"}</b></div>
                                <div><span>Subject</span><b className="tprm-mp-subject">{prev.subject}</b></div>
                            </div>
                            {/* The email is a full document with its own styles. An
                                iframe keeps them out of the app's CSS and the app's
                                out of the email, which dangerouslySetInnerHTML cannot. */}
                            <iframe
                                title={`Email preview — ${rcpt ? rcpt.name : ""}`}
                                className="tprm-mp-frame"
                                srcDoc={prev.html}
                            />
                        </>
                    ) : null}
                </div>

                <div className="tprm-mp-foot">
                    {result && (
                        <span className="tprm-mp-result">
                            {result.error
                                ? result.error
                                : `${result.sent || 0} sent`
                                  + (result.failed ? `, ${result.failed} failed` : "")
                                  + (result.skipped ? `, ${result.skipped} skipped` : "")}
                        </span>
                    )}
                    {previewOnly || result ? (
                        <button className="tprm-btn primary" onClick={onClose}>
                            {result ? "Done" : "Close"}
                        </button>
                    ) : (
                        <>
                            <button className="tprm-btn" onClick={onClose} disabled={sending}>Cancel</button>
                            <button
                                className="tprm-btn gold"
                                onClick={send}
                                disabled={sending || loading || !!error || !sendableChecked.length}
                                title={!sendableChecked.length ? "Nobody on this list can be sent to" : undefined}
                            >
                                <FaPaperPlane style={{ marginRight: 6 }} />
                                {sending ? "Sending…" : `Send (${sendableChecked.length})`}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default TPRMMailPreview;
