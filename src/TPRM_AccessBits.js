// Shared furniture for the access screens: the logo lock and the centred card.
//
// Both are lifted straight from Dolluz_TPRM_UI_Reference.jsx so Login, Two
// factor, Forgot password and Accept invitation are demonstrably the same
// object at different sizes, rather than four screens that resemble each other.

import React from "react";
import logo_eagle from "./assets/img/logo_eagle.png";
import "./TPRM_Access.css";

/** Eagle beside the two-line wordmark. `dark` for the banner pane, `sm` for
 *  the .86 scale the reference uses above the sign-in form. */
export function LogoLock({ dark, sm }) {
    return (
        <div className={"tprm-lock" + (dark ? " dark" : "") + (sm ? " sm" : "")}>
            <img src={logo_eagle} alt="" />
            <div>
                <div className="tprm-lock-name">DOLLUZ CORP</div>
                <div className="tprm-lock-sub">TPRM TOOLKIT</div>
            </div>
        </div>
    );
}

/** The card every screen other than Login sits in. */
export function Centered({ title, sub, wide, children }) {
    return (
        <div className="tprm-centered">
            <div className={"tprm-centered-inner" + (wide ? " wide" : "")}>
                <div className="tprm-centered-brand">
                    <div className="n">DOLLUZ CORP</div>
                    <div className="s">TPRM TOOLKIT</div>
                </div>
                <div className="tprm-card" style={{ padding: 34 }}>
                    <div className="tprm-centered-title">{title}</div>
                    {sub && <div className="tprm-centered-sub">{sub}</div>}
                    {children}
                </div>
            </div>
        </div>
    );
}

/**
 * Six boxes for a six digit code.
 *
 * Typing advances, Backspace on an empty box steps back, and a pasted code
 * fills the row - people paste these far more often than they type them, and a
 * six-box control that cannot be pasted into is worse than one field.
 */
export function OtpBoxes({ value, onChange, onComplete, disabled }) {
    const refs = React.useRef([]);
    const digits = String(value || "").padEnd(6, " ").slice(0, 6).split("");

    const put = (i, ch) => {
        const next = digits.map(d => (d === " " ? "" : d));
        next[i] = ch;
        const joined = next.join("").slice(0, 6);
        onChange(joined);
        return joined;
    };

    const onInput = (i, raw) => {
        const only = raw.replace(/\D/g, "");
        if (!only) { put(i, ""); return; }
        if (only.length > 1) {          // a paste landed in one box
            const joined = (digits.join("").replace(/\s/g, "").slice(0, i) + only).slice(0, 6);
            onChange(joined);
            const at = Math.min(joined.length, 5);
            if (refs.current[at]) refs.current[at].focus();
            if (joined.length === 6 && onComplete) onComplete(joined);
            return;
        }
        const joined = put(i, only);
        if (i < 5 && refs.current[i + 1]) refs.current[i + 1].focus();
        if (joined.replace(/\s/g, "").length === 6 && onComplete) onComplete(joined);
    };

    const onKey = (i, e) => {
        if (e.key === "Backspace" && !digits[i].trim() && i > 0) {
            e.preventDefault();
            put(i - 1, "");
            refs.current[i - 1].focus();
        }
        if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1].focus();
        if (e.key === "ArrowRight" && i < 5) refs.current[i + 1].focus();
    };

    return (
        <div className="tprm-otp">
            {digits.map((d, i) => (
                <input
                    key={i}
                    ref={el => { refs.current[i] = el; }}
                    className={d.trim() ? "filled" : ""}
                    value={d.trim()}
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    maxLength={6}
                    disabled={disabled}
                    aria-label={`Digit ${i + 1}`}
                    autoFocus={i === 0}
                    onChange={e => onInput(i, e.target.value)}
                    onKeyDown={e => onKey(i, e)}
                    onFocus={e => e.target.select()}
                />
            ))}
        </div>
    );
}
