// Sign in.
//
// Rebuilt against Dolluz_TPRM_UI_Reference.jsx. Every measurement, every string
// and the order of every element come from that file.
//
// The screen is two panes: a rotating banner that says what the product is for,
// and a form that asks for as little as possible. The banner is not decoration -
// it carries the three numbers that describe the library a client buys into.

import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { apiFetch, apiPost } from "./utils/api";
import useAutofillSync from "./utils/useAutofillSync";
import { useAccess } from "./utils/AccessContext";
import { LogoLock, Centered, OtpBoxes } from "./TPRM_AccessBits";
import logo_eagle from "./assets/img/logo_eagle.png";
import "./TPRM_Access.css";

// Fallback only. The live banners come from the banner table where active = 1,
// ordered by sort_order, so a Practice Head changes them without a deploy.
// These three cover the one moment that call cannot be reached: the database
// being down, when the sign-in screen still has to render.
const FALLBACK = [
    {
        banner_id: -1, tag_label: "TPRM",
        headline: "Third party risk, evidenced",
        subline: "An assertion is not evidence. Every control we score carries the proof behind it.",
        gradient_from: "#0E1A2B", gradient_to: "#1E3350",
    },
    {
        banner_id: -2, tag_label: "TECHNICAL ASSURANCE",
        headline: "Assurance that holds up",
        subline: "We test the estate the way an attacker would, and report it the way a board can act on.",
        gradient_from: "#123F3A", gradient_to: "#1B7A5A",
    },
    {
        banner_id: -3, tag_label: "DOLLUZ CORP",
        headline: "Cyber resilience, end to end",
        subline: "Assurance and third party risk on one contract, so both halves of the problem talk to each other.",
        gradient_from: "#3D2E08", gradient_to: "#8A6D12",
    },
];

// What the library holds, shown on the way in.
const STATS = [
    ["36", "sector instruments"],
    ["652", "questions"],
    ["85", "standards mapped"],
];

// A sign-in failure is deliberately one message. Saying which field was wrong
// tells an attacker whether the address exists.
const SIGNIN_FAILED = "That email and password combination was not recognised.";

const MESSAGES = {
    EMAIL_NOT_FOUND: SIGNIN_FAILED,
    INVALID_CREDENTIALS: SIGNIN_FAILED,
    MFA_INVALID: "That code is not correct.",
    RESEND_LIMIT: "Too many codes sent. Sign in again to start over.",
    NO_ENGAGEMENT:
        "Your account is valid, but you have not been assigned to a client engagement in dTprm yet. "
        + "Ask a Practice Head or Engagement Manager to grant you a role.",
};

function TPRMLogin() {
    const navigate = useNavigate();
    const location = useLocation();
    const { refetch } = useAccess();

    const [i, setI] = useState(0);
    const [panels, setPanels] = useState(FALLBACK);
    const [hover, setHover] = useState(false);

    // login -> mfa -> Dashboard, plus the forgot-password detour.
    const [step, setStep] = useState("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    // A saved credential filled by the browser never fires onChange, so without
    // this the fields look complete while Continue stays greyed out.
    const emailRef = useRef(null);
    const passRef = useRef(null);
    const [remember, setRemember] = useState(true);
    const [mfaToken, setMfaToken] = useState(null);
    const [code, setCode] = useState("");
    // Seconds left on the code the server issued. Counted down here rather
    // than guessed: the value comes from the same route that created it.
    const [expiresIn, setExpiresIn] = useState(0);

    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const [showPass, setShowPass] = useState(false);
    const [caps, setCaps] = useState(false);
    const [bounced, setBounced] = useState(
        () => (location.state && location.state.message) || null);

    useAutofillSync([
        { ref: emailRef, value: username, set: setUsername },
        { ref: passRef, value: password, set: setPassword },
    ]);

    useEffect(() => {
        let live = true;
        apiFetch("/api/tprm/banners/public")
            .then(r => (r.ok ? r.json() : []))
            .then(rows => { if (live && rows.length) { setPanels(rows); setI(0); } })
            .catch(() => { /* FALLBACK already on screen */ });
        return () => { live = false; };
    }, []);

    // Three seconds, paused while the pointer rests on the pane so a reader is
    // never interrupted mid-sentence.
    useEffect(() => {
        if (hover || panels.length < 2) return;
        const t = setInterval(() => setI(x => (x + 1) % panels.length), 3000);
        return () => clearInterval(t);
    }, [hover, panels.length]);

    // Someone already signed into a sibling dApp has proved who they are but
    // not to this product, so they resume at the code step rather than retyping
    // a password they have already given.
    useEffect(() => {
        let live = true;
        apiPost("/api/tprm/login/mfa/resume", {})
            .then(r => {
                if (!live || !r || !r.mfaToken) return;
                setMfaToken(r.mfaToken);
                setUsername(r.email || "");
                setExpiresIn(Number(r.expiresIn) || 0);
                setStep("mfa");
            })
            .catch(() => { /* no sibling session: the login step is correct */ });
        return () => { live = false; };
    }, []);

    // One interval, running only while there is something left to count.
    useEffect(() => {
        if (step !== "mfa" || expiresIn <= 0) return;
        const t = setInterval(() => setExpiresIn(v => (v > 0 ? v - 1 : 0)), 1000);
        return () => clearInterval(t);
    }, [step, expiresIn]);

    const fail = (e) => setErr(MESSAGES[e.message] || e.message || "Could not sign you in");

    const backToLogin = (message) => {
        setStep("login");
        setMfaToken(null); setCode(""); setExpiresIn(0); setPassword("");
        setErr(message || null);
    };

    /* ------------------------------------------------------- step one */
    const submitLogin = async (e) => {
        if (e) e.preventDefault();
        setErr(null);

        // Read the fields, not the state. Chrome fills a saved password on load
        // but withholds the value from scripts until the person does something -
        // clicking this button is that something, so by the time we are here the
        // value is readable even though state was empty a moment ago. Anything
        // gated on state before the click would still be waiting.
        const email = (emailRef.current ? emailRef.current.value : username).trim();
        const pass = passRef.current ? passRef.current.value : password;
        if (email !== username) setUsername(email);
        if (pass !== password) setPassword(pass);

        if (!email || !pass) {
            setErr(!email && !pass ? "Enter your work email and password."
                : !email ? "Enter your work email."
                    : "Enter your password.");
            (!email ? emailRef : passRef).current?.focus();
            return;
        }

        setBusy(true);
        try {
            const r = await apiPost("/api/tprm/login/Verifylogin",
                { username: email, password: pass, remember });
            setMfaToken(r.mfaToken);
            setExpiresIn(Number(r.expiresIn) || 0);
            setCode("");
            setStep("mfa");
        } catch (e2) {
            fail(e2);
        } finally {
            setBusy(false);
        }
    };

    const resend = async () => {
        setErr(null);
        setBusy(true);
        try {
            const r = await apiPost("/api/tprm/login/mfa/resend", { mfaToken });
            setExpiresIn(Number(r.expiresIn) || 0);
            setCode("");
        } catch (e2) {
            if (e2.message === "MFA_TOKEN_INVALID") {
                backToLogin("That took too long. Please sign in again.");
            } else {
                fail(e2);
            }
        } finally {
            setBusy(false);
        }
    };

    /* ------------------------------------------------------- step two */
    const submitCode = async (value) => {
        const entered = value !== undefined ? value : code;
        setErr(null);
        setBusy(true);
        try {
            await apiPost("/api/tprm/login/mfa/verify", { mfaToken, code: entered });
            await refetch();
            navigate("/Dashboard", { replace: true });
        } catch (e2) {
            if (e2.message === "MFA_TOKEN_INVALID") {
                backToLogin("That step timed out. Please sign in again.");
            } else if (e2.message === "MFA_LOCKED" || e2.message === "OTP_BURNED") {
                // Three failures returns to the login screen and writes an
                // audit event, which is what the spec asks for.
                backToLogin("Too many incorrect codes. Sign in again to try once more.");
            } else if (e2.message === "OTP_EXPIRED") {
                // Not an error to apologise for - the countdown said it would
                // happen. Zero the clock and the Resend button takes over.
                setExpiresIn(0); setCode("");
            } else {
                fail(e2);
                setCode("");
            }
        } finally {
            setBusy(false);
        }
    };

    const p = panels[Math.min(i, panels.length - 1)] || {};
    const gradient = `linear-gradient(140deg, ${p.gradient_from || "#0E1A2B"} 0%, `
        + `${p.gradient_to || "#1E3350"} 100%)`;

    /* ----------------------------------------------- forgot password */
    if (step === "forgot" || step === "forgotSent") {
        const sent = step === "forgotSent";
        return (
            <Centered
                title={sent ? "Check your inbox" : "Forgot password"}
                sub={sent
                    ? "If that address belongs to an account, a reset link is on its way. The link expires in 30 minutes and can be used once."
                    : "Enter your work email and we will send a single use reset link."}
            >
                {!sent ? (
                    <form onSubmit={e => { e.preventDefault(); setStep("forgotSent"); }}>
                        <div className="tprm-field">
                            <label htmlFor="tprm-forgot-email">Work email</label>
                            <input
                                id="tprm-forgot-email"
                                className="tprm-input"
                                type="email"
                                autoFocus
                                value={username}
                                placeholder="name@dolluzcorp.com"
                                onChange={e => setUsername(e.target.value)}
                            />
                        </div>
                        <button type="submit" className="tprm-btn primary wide" disabled={!username}>
                            Send reset link
                        </button>
                        <div className="tprm-note" style={{ marginTop: 18 }}>
                            The confirmation is identical whether or not the address exists, so this
                            screen cannot be used to discover valid accounts.
                        </div>
                    </form>
                ) : (
                    <button className="tprm-btn wide" onClick={() => backToLogin(null)}>
                        Back to sign in
                    </button>
                )}
                <div className="tprm-access-link">
                    <button className="tprm-linkbtn" onClick={() => backToLogin(null)}>
                        Back to sign in
                    </button>
                </div>
            </Centered>
        );
    }

    /* ---------------------------------------------------- two factor */
    // 1:47, not 107 seconds. Nobody counts in seconds past sixty.
    const mmss = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
    const expired = step === "mfa" && expiresIn <= 0;
    const low = expiresIn > 0 && expiresIn <= 30;

    if (step === "mfa") {
        return (
            <Centered
                title="Two factor"
                sub={`Signed in as ${username || "your account"}. `
                    + "Enter the six digit code from your authenticator app."}
            >
                <OtpBoxes
                    key={expiresIn > 0 ? "live" : "dead"}
                    value={code}
                    onChange={setCode}
                    onComplete={v => submitCode(v)}
                    disabled={busy || expired}
                />

                {/* The clock is the reason the Resend button is not there yet,
                    so the two occupy the same line rather than sitting apart. */}
                <div className={"tprm-otp-clock" + (expired ? " out" : low ? " low" : "")}>
                    {expired
                        ? "That code has expired."
                        : <>Code expires in <b className="mono">{mmss(expiresIn)}</b></>}
                </div>

                {err && <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err}</div>}

                {expired ? (
                    <button
                        className="tprm-btn gold wide"
                        disabled={busy}
                        onClick={resend}
                    >
                        {busy ? "Sending…" : "Resend code"}
                    </button>
                ) : (
                    <button
                        className="tprm-btn primary wide"
                        disabled={busy || code.replace(/\D/g, "").length < 6}
                        onClick={() => submitCode()}
                    >
                        {busy ? "Verifying…" : "Verify and continue"}
                    </button>
                )}

                <div className="tprm-note" style={{ marginTop: 20 }}>
                    Mandatory for every role, including Client Viewer. Three failures returns to the
                    login screen and writes an audit event.
                </div>

                <div className="tprm-access-link">
                    <button className="tprm-linkbtn" onClick={() => backToLogin(null)}>
                        Back to sign in
                    </button>
                </div>
            </Centered>
        );
    }

    /* --------------------------------------------------------- login */
    return (
        <div className="tprm-login">
            <div
                className="tprm-login-panel"
                style={{ background: gradient }}
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
            >
                <img className="tprm-login-mark" src={logo_eagle} alt="" />
                {/* Six concentric rings, barely there. The pane is otherwise a
                    flat gradient, and a flat gradient reads as a placeholder
                    rather than as a design. */}
                <svg className="tprm-login-rings" viewBox="0 0 600 600" aria-hidden="true">
                    {[0, 1, 2, 3, 4, 5].map(n => (
                        <circle key={n} cx="300" cy="300" r={60 + n * 48}
                            fill="none" stroke="#fff" strokeWidth="1.4" />
                    ))}
                </svg>

                <LogoLock dark />

                <div className="tprm-login-panelbody">
                    {p.tag_label && <div className="tprm-login-tag">{p.tag_label}</div>}
                    <h1 className="tprm-login-headline">{p.headline}</h1>
                    <p className="tprm-login-sub">{p.subline}</p>
                    <div className="tprm-login-rule" />
                    <div className="tprm-login-stats">
                        {STATS.map(([n, label]) => (
                            <div key={label}>
                                <div className="tprm-login-stat-n">{n}</div>
                                <div className="tprm-login-stat-l">{label}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="tprm-login-dots">
                    {panels.map((_, n) => (
                        <button
                            key={n}
                            type="button"
                            aria-label={`Panel ${n + 1}`}
                            className={n === i ? "on" : ""}
                            onClick={() => setI(n)}
                        />
                    ))}
                    <span className="tprm-login-rotstate">
                        {hover ? "Paused" : "Rotating every 3 seconds"}
                    </span>
                </div>

                <div className="tprm-login-tagline">ONE PLACE . ONE START . ONE TEAM</div>
            </div>

            <div className="tprm-login-form">
                <div className="tprm-login-formbox">
                    <div className="tprm-login-formlock"><LogoLock sm /></div>
                    <h2>Sign in</h2>
                    <p className="tprm-login-formsub">Internal staff and invited client users</p>

                    <form onSubmit={submitLogin}>
                        <div className="tprm-field">
                            <label htmlFor="tprm-email">Work email</label>
                            <input
                                id="tprm-email"
                                ref={emailRef}
                                className="tprm-input"
                                autoFocus
                                type="email"
                                autoComplete="username"
                                value={username}
                                onChange={e => { setUsername(e.target.value); setErr(null); setBounced(null); }}
                                placeholder="name@dolluzcorp.com"
                            />
                        </div>

                        <div className="tprm-field">
                            <label htmlFor="tprm-pass">Password</label>
                            <div className="tprm-passwrap">
                                <input
                                    id="tprm-pass"
                                    ref={passRef}
                                    className="tprm-input"
                                    type={showPass ? "text" : "password"}
                                    autoComplete="current-password"
                                    value={password}
                                    placeholder="Your password"
                                    onChange={e => { setPassword(e.target.value); setErr(null); setBounced(null); }}
                                    onKeyUp={e => setCaps(e.getModifierState && e.getModifierState("CapsLock"))}
                                    onBlur={() => setCaps(false)}
                                />
                                <button
                                    type="button"
                                    className="tprm-passtoggle"
                                    onClick={() => setShowPass(v => !v)}
                                    aria-label={showPass ? "Hide password" : "Show password"}
                                    aria-pressed={showPass}
                                    tabIndex={-1}
                                >
                                    {showPass ? <FaEyeSlash /> : <FaEye />}
                                </button>
                            </div>
                            {caps && (
                                <div className="tprm-hint" style={{ color: "var(--tprm-amber)" }}>
                                    Caps Lock is on
                                </div>
                            )}
                        </div>

                        <div className="tprm-login-optrow">
                            <label className="tprm-login-remember">
                                <input
                                    type="checkbox"
                                    checked={remember}
                                    onChange={e => setRemember(e.target.checked)}
                                />
                                Remember for 14 days
                            </label>
                            <button
                                type="button"
                                className="tprm-linkbtn tprm-login-forgot"
                                onClick={() => { setErr(null); setStep("forgot"); }}
                            >
                                Forgot password
                            </button>
                        </div>

                        {bounced && !err && (
                            <div className="tprm-note warn" style={{ marginBottom: 14 }}>{bounced}</div>
                        )}
                        {err && <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err}</div>}

                        <button
                            type="submit"
                            className="tprm-btn primary wide"
                            disabled={busy}
                        >
                            {busy ? "Checking…" : "Continue"}
                        </button>
                    </form>

                    <div className="tprm-login-foot">
                        Two factor is required at the next step for every account, internal and
                        external.
                    </div>
                </div>
            </div>
        </div>
    );
}

export default TPRMLogin;
