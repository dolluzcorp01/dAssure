// A select with a search box.
//
// Replaces every native <select> in the product. The reason is the instrument
// picker: 36 options, most reading "(no published version)", and no way to get
// to "Manufacturing and OT" except scrolling. The same problem shows up on the
// client picker, the sector picker in Classify and the employee picker when
// granting a role - all of which grow with real data.
//
// Deliberately close to a native select in behaviour, because the thing it
// replaces was already understood:
//   - typing filters, it does not create
//   - Up/Down move, Enter chooses, Escape closes without changing anything
//   - the closed control shows the current label, not a placeholder
//   - it is a button, so it is reachable and operable from the keyboard
//
// The panel is rendered through a portal onto document.body and positioned
// with fixed coordinates. It has to be: a select inside a table cell sits
// inside .tprm-card.flush, which is overflow:hidden, and inside the authoring
// tables which scroll horizontally. An absolutely positioned panel is clipped
// by either of those - it cannot escape a scrolling ancestor. A portal has no
// such ancestor, so the panel is drawn over the page and follows the trigger
// while the page moves under it.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaChevronDown, FaSearch, FaCheck } from "react-icons/fa";
import "./TPRM_Select.css";

const SEARCH_FROM = 7;
const PANEL_MIN = 260;
const PANEL_MAX_H = 300;

function TPRMSelect({
    value,
    onChange,                 // (value) => void
    options,
    placeholder = "— choose —",
    disabled = false,
    id,
    className = "",
    style,
    ariaLabel,
    searchable,
}) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [active, setActive] = useState(0);
    const [pos, setPos] = useState(null);     // { left, top, width, up }
    const wrapRef = useRef(null);
    const panelRef = useRef(null);
    const searchRef = useRef(null);
    const listRef = useRef(null);

    const opts = useMemo(() => options || [], [options]);
    const showSearch = searchable !== undefined ? searchable : opts.length >= SEARCH_FROM;
    const selected = opts.find(o => String(o.value) === String(value)) || null;

    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) return opts;
        return opts.filter(o =>
            String(o.label).toLowerCase().includes(needle)
            || String(o.value).toLowerCase().includes(needle)
            || String(o.hint || "").toLowerCase().includes(needle));
    }, [opts, q]);

    /** Where the panel goes, in viewport coordinates. Recomputed whenever the
     *  page moves, so the panel stays welded to its trigger. */
    const place = useCallback(() => {
        const el = wrapRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const below = window.innerHeight - r.bottom;
        const up = below < PANEL_MAX_H && r.top > below;
        const width = Math.max(r.width, PANEL_MIN);
        // Keep it on screen when the trigger sits near the right edge.
        const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
        setPos({ left, top: up ? r.top - 4 : r.bottom + 4, width, up });
    }, []);

    useLayoutEffect(() => {
        if (!open) { setPos(null); return; }
        place();
        setQ("");
        const i = opts.findIndex(o => String(o.value) === String(value));
        setActive(i >= 0 ? i : 0);
        if (showSearch) setTimeout(() => searchRef.current && searchRef.current.focus(), 20);
    }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Follow the trigger through any scroll, including a table scrolling
    // sideways under it. `true` catches scrolls on ancestors, not just window.
    useEffect(() => {
        if (!open) return;
        const onMove = () => {
            const el = wrapRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            // Trigger scrolled out of sight: nothing to attach to any more.
            if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; }
            place();
        };
        window.addEventListener("scroll", onMove, true);
        window.addEventListener("resize", onMove);
        return () => {
            window.removeEventListener("scroll", onMove, true);
            window.removeEventListener("resize", onMove);
        };
    }, [open, place]);

    // The panel lives outside the wrapper now, so an outside click has to
    // check both or choosing an option would close before the click lands.
    useEffect(() => {
        if (!open) return;
        const away = (e) => {
            if (wrapRef.current && wrapRef.current.contains(e.target)) return;
            if (panelRef.current && panelRef.current.contains(e.target)) return;
            setOpen(false);
        };
        document.addEventListener("mousedown", away);
        return () => document.removeEventListener("mousedown", away);
    }, [open]);

    useEffect(() => {
        if (!open || !listRef.current) return;
        const el = listRef.current.querySelector('[data-active="1"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }, [active, open]);

    const pick = (o) => {
        if (o.disabled) return;
        onChange(o.value);
        setOpen(false);
    };

    const onKeyDown = (e) => {
        if (disabled) return;
        if (!open) {
            if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); setOpen(true); }
            return;
        }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
        if (e.key === "Enter") {
            e.preventDefault(); e.stopPropagation();
            const o = shown[active];
            if (o) pick(o);
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            let i = active;
            for (let n = 0; n < shown.length; n++) {
                i = (i + step + shown.length) % shown.length;
                if (!shown[i].disabled) break;
            }
            setActive(i);
        }
    };

    const panel = open && pos ? createPortal(
        <div
            ref={panelRef}
            className={"tprm-sel-drop" + (pos.up ? " up" : "")}
            role="listbox"
            style={{
                left: pos.left,
                width: pos.width,
                ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
        >
            {showSearch && (
                <div className="tprm-sel-search">
                    <FaSearch />
                    <input
                        ref={searchRef}
                        value={q}
                        placeholder="Type to filter"
                        onChange={e => { setQ(e.target.value); setActive(0); }}
                        onKeyDown={onKeyDown}
                    />
                </div>
            )}
            <div className="tprm-sel-list" ref={listRef}>
                {shown.map((o, i) => {
                    const on = String(o.value) === String(value);
                    return (
                        <button
                            type="button"
                            key={String(o.value)}
                            role="option"
                            aria-selected={on}
                            data-active={i === active ? "1" : "0"}
                            className={"tprm-sel-opt"
                                + (on ? " on" : "")
                                + (i === active ? " active" : "")
                                + (o.disabled ? " disabled" : "")}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => pick(o)}
                            disabled={o.disabled}
                        >
                            <span className="tprm-sel-opt-label" title={o.label}>
                                {o.label}
                                {o.hint && <span className="tprm-sel-opt-hint">{o.hint}</span>}
                            </span>
                            {on && <FaCheck className="tprm-sel-tick" />}
                        </button>
                    );
                })}
                {shown.length === 0 && (
                    <div className="tprm-sel-empty">Nothing matches “{q}”.</div>
                )}
            </div>
        </div>,
        document.body) : null;

    return (
        <div
            className={"tprm-sel" + (open ? " open" : "") + (disabled ? " disabled" : "") + (className ? " " + className : "")}
            ref={wrapRef}
            style={style}
        >
            <button
                type="button"
                id={id}
                className="tprm-sel-btn"
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={ariaLabel}
                onClick={() => !disabled && setOpen(o => !o)}
                onKeyDown={onKeyDown}
            >
                <span className={"tprm-sel-value" + (selected ? "" : " placeholder")}>
                    {selected ? selected.label : placeholder}
                </span>
                <FaChevronDown className="tprm-sel-caret" />
            </button>
            {panel}
        </div>
    );
}

export default TPRMSelect;
