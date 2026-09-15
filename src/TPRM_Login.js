// Sign in.
//
// Rebuilt against Dolluz_TPRM_UI_Reference.jsx. Every measurement, every string
// and the order of every element come from that file.
//
// The screen is two panes: a rotating banner that says what the product is for,
// and a form that asks for as little as possible.
//
// The banner panel is configured in dAdmin - Inside D -> Login Page Config -
// along with the rotation interval, the three figures and whether two-step
// sign-in is on at all. This screen reads that config cross-origin and falls
// back to its own copy of it whenever dAdmin cannot be reached: the sign-in has
// to render, and work, with dAdmin down.

import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { apiPost, DADMIN_API_BASE } from "./utils/api";
import useAutofillSync from "./utils/useAutofillSync";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import { LogoLock, Centered } from "./TPRM_AccessBits";
import logo_eagle from "./assets/img/logo_eagle.png";
import "./TPRM_Access.css";

// Which dAdmin config row governs this screen. Exact case - it must match
// LOGIN_APPS in dAdmin's Login_banner_server.js, or dAdmin answers with no
// banners and this screen quietly shows its fallback forever.
const APP_KEY = "dAssure";

// Fallback only: the same three banners dAdmin holds for dAssure, so the
// fallback and the live data agree and a dAdmin outage changes nothing visible.
const FALLBACK_BANNERS = [
    {
        banner_id: -1, tag_label: "EVIDENCE",
        headline: "An assertion is not evidence",
        subline: "A control claimed without proof is recorded as Not Evidenced and scores accordingly. The rule enforces itself.",
        gradient_from: "#0E1A2B", gradient_to: "#1E3350",
    },
    {
        banner_id: -2, tag_label: "SEGREGATION",
        headline: "Nobody approves their own work",
        subline: "The reviewer can never be the assessor. Enforced in the database, not only in the interface.",
        gradient_from: "#123F3A", gradient_to: "#1B7A5A",
    },
    {
        banner_id: -3, tag_label: "TRACEABILITY",
        headline: "Every score traces to an answer",
        subline: "Residual risk is derived from inherent risk and control effectiveness. It is never typed in by hand.",
        gradient_from: "#3D2E08", gradient_to: "#8A6D12",
    },
];

// What the library holds, shown on the way in - the fallback for dAdmin's
// panel_stats. Strings on purpose: "652" and "24/7" belong in the same slot.
const FALLBACK_STATS = [
    { value: "36", label: "sector instruments" },
    { value: "652", label: "questions" },
    { value: "85", label: "standards mapped" },
];

// Until dAdmin answers. Two-step ON, so a failed fetch can never hide the
// remember control and so imply that verification is off. The server enforces
// the real setting either way; this only decides what is shown.
const DEFAULT_SIGNIN = { two_factor_enabled: 1, trust_days: 14 };

// A sign-in failure is deliberately one message. Saying which field was wrong
// tells an attacker whether the address exists.
const SIGNIN_FAILED = "That email and password combination was not recognised.";

const MESSAGES = {
    EMAIL_NOT_FOUND: SIGNIN_FAILED,
    INVALID_CREDENTIALS: SIGNIN_FAILED,
    MFA_INVALID: "That code is not correct.",
    RESEND_LIMIT: "Too many codes sent. Sign in again to start over.",
    RESEND_TOO_SOON: "Wait a few seconds before asking for another code.",
    OTP_EXPIRED: "That code has expired. Ask for another one.",
    OTP_BURNED: "That code is no longer usable. Start again and we will send a new one.",
    OTP_NOT_SENT: "No code is waiting on that address. Start again.",
    RESET_TOKEN_INVALID: "That reset attempt has expired. Start again.",
    SET_TOKEN_INVALID: "That took too long. Enter your address again for a fresh code.",
    PASSWORD_MISMATCH: "The two passwords do not match.",
    CURRENT_PASSWORD_WRONG: "That is not your current password.",
    PASSWORD_UNCHANGED: "Choose a password different from the one you have now.",
    NO_ENGAGEMENT:
        "Your account is valid, but you have not been assigned to a client engagement in dAssure yet. "
        + "Ask a Practice Head or Engagement Manager to grant you a role.",
};

// 1:47, not 107 seconds. Nobody counts in seconds past sixty.
const clock = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;

/** The eye, for every password field on this screen. Out of the tab order so
 *  tabbing goes field to field, not field to toggle to field. */
function Reveal({ shown, onToggle }) {
    return (
        <button
            type="button"
            className="tprm-passtoggle"
            onClick={onToggle}
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            tabIndex={-1}
        >
            {shown ? <FaEyeSlash /> : <FaEye />}
        </button>
    );
}

function TPRMLogin() {
    const navigate = useNavigate();
    const location = useLocation();
    const { refetch } = useAccess();

    /* ------------------------------------------ the banner panel, from dAdmin */
    const [i, setI] = useState(0);
    const [panels, setPanels] = useState(FALLBACK_BANNERS);
    const [panelStats, setPanelStats] = useState(FALLBACK_STATS);
    const [rotateSecs, setRotateSecs] = useState(3);
    const [signinCfg, setSigninCfg] = useState(DEFAULT_SIGNIN);
    const [hover, setHover] = useState(false);

    // login -> mfa -> Dashboard; the forgot-password detour; and, reached with
    // ?changePassword by someone already signed in, the change-password pair.
    const [step, setStep] = useState(() =>
        new URLSearchParams(location.search).has("changePassword") ? "changePassword" : "login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    // A saved credential filled by the browser never fires onChange, so without
    // this the fields look complete while Continue stays greyed out.
    const emailRef = useRef(null);
    const passRef = useRef(null);
    // Unticked. Pre-ticking it would opt everybody into the whole trust window
    // of skipped codes without their having chosen it.
    const [remember, setRemember] = useState(false);
    const [mfaToken, setMfaToken] = useState(null);
    const [mfaEmail, setMfaEmail] = useState("");
    // True when the code step came from /mfa/resume: signed in to a sibling
    // app, so no password was typed here and the lede must not claim one was.
    const [resumed, setResumed] = useState(false);
    const [code, setCode] = useState("");
    // Seconds left on the code the server issued. Counted down here rather
    // than guessed: the value comes from the same route that created it.
    const [expiresIn, setExpiresIn] = useState(0);
    // Seconds before the server will post another sign-in code. It refuses a
    // resend inside that window anyway (RESEND_TOO_SOON); counting it down here
    // just says so on the link instead of letting the click fail.
    const [resendIn, setResendIn] = useState(0);
    /* The reset walk. Two typed tokens, because the browser has to cross two
       gaps: address to code, and code to new password. resetToken says an
       address was submitted; setToken is minted only once a code is redeemed,
       and only it opens the last step. */
    const [resetToken, setResetToken] = useState(null);
    const [setToken, setSetToken] = useState(null);
    const [newPass, setNewPass] = useState("");
    const [confirmPass, setConfirmPass] = useState("");
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [maskedReset, setMaskedReset] = useState("");
    const [pwHelp, setPwHelp] = useState("");
    // Change password. The current password is held until the final call,
    // because the server checks it again at the point of write.
    const [currentPass, setCurrentPass] = useState("");
    const [showCurrent, setShowCurrent] = useState(false);

    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    // Which busy it is, when it is a resend - so the resend link says
    // Sending while the verify button does not claim to be verifying.
    const [sending, setSending] = useState(false);
    const [showPass, setShowPass] = useState(false);
    const [caps, setCaps] = useState(false);
    const [bounced, setBounced] = useState(
        () => (location.state && location.state.message) || null);

    // Arriving with a reason - a session an administrator ended, an account
    // with no engagement - means the reason is the thing to read. Resuming
    // straight into a code step would mail a code and bury the explanation.
    // Nor is there anything to resume when the visit is to change a password.
    const skipResume = useRef(Boolean(location.state && location.state.message)
        || new URLSearchParams(location.search).has("changePassword"));

    useAutofillSync([
        { ref: emailRef, value: username, set: setUsername },
        { ref: passRef, value: password, set: setPassword },
    ]);

    // The panel config. A plain fetch: another origin, no cookie, no tenant id.
    useEffect(() => {
        let live = true;
        fetch(`${DADMIN_API_BASE}/api/login-banners/public?app=${encodeURIComponent(APP_KEY)}`)
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (!live || !data) return;
                // Only replace on a non-empty list. An app with no banners
                // configured keeps the fallback rather than a blank panel.
                if (Array.isArray(data.banners) && data.banners.length) {
                    setPanels(data.banners);
                    setI(0);
                }
                const secs = Number(data.rotate_seconds);
                if (Number.isFinite(secs) && secs > 0) setRotateSecs(secs);
                // An empty array is a real answer - "show no figures" - so only
                // null or a missing field keeps the built-in three.
                if (Array.isArray(data.panel_stats)) setPanelStats(data.panel_stats);
                setSigninCfg({
                    // Only an explicit 0 is "off".
                    two_factor_enabled: Number(data.two_factor_enabled) === 0 ? 0 : 1,
                    trust_days: Number(data.trust_days) || DEFAULT_SIGNIN.trust_days,
                });
            })
            .catch(() => { /* the fallback is already on screen */ });
        return () => { live = false; };
    }, []);

    // Rotates at dAdmin's interval, never faster than two seconds, paused while
    // the pointer rests on the pane so a reader is never interrupted
    // mid-sentence, and not at all with a single banner.
    useEffect(() => {
        if (hover || panels.length < 2) return;
        const t = setInterval(() => setI(x => (x + 1) % panels.length),
            Math.max(2, rotateSecs) * 1000);
        return () => clearInterval(t);
    }, [hover, panels.length, rotateSecs]);

    // Someone already signed into a sibling dApp has proved who they are but
    // not to this product, so they resume at the code step rather than retyping
    // a password they have already given. With two-step off the server answers
    // NO_SESSION, and the password step is the right place to be.
    useEffect(() => {
        if (skipResume.current) return;
        let live = true;
        apiPost("/api/tprm/login/mfa/resume", {})
            .then(r => {
                if (!live || !r || !r.mfaToken) return;
                setMfaToken(r.mfaToken);
                setMfaEmail(r.maskedEmail || "");
                setResumed(true);
                setExpiresIn(Number(r.expiresIn) || 0);
                setResendIn(Number(r.resendIn) || 0);
                setStep("mfa");
                tprmAlert.success("Check your email",
                    `We sent a sign-in code to ${r.maskedEmail || "your work email"}.`);
            })
            .catch(() => { /* no sibling session: the login step is correct */ });
        return () => { live = false; };
    }, []);

    // One interval, running only while there is something left to count.
    useEffect(() => {
        if ((step !== "mfa" && step !== "forgotCode") || expiresIn <= 0) return;
        const t = setInterval(() => setExpiresIn(v => (v > 0 ? v - 1 : 0)), 1000);
        return () => clearInterval(t);
    }, [step, expiresIn]);

    useEffect(() => {
        if (step !== "mfa" || resendIn <= 0) return;
        const t = setInterval(() => setResendIn(v => (v > 0 ? v - 1 : 0)), 1000);
        return () => clearInterval(t);
    }, [step, resendIn]);

    const fail = (e) => setErr(MESSAGES[e.message] || e.message || "Could not sign you in");

    const backToLogin = (message) => {
        setStep("login");
        setMfaToken(null); setMfaEmail(""); setResumed(false);
        setCode(""); setExpiresIn(0); setResendIn(0); setPassword("");
        setResetToken(null); setSetToken(null);
        setNewPass(""); setConfirmPass(""); setMaskedReset(""); setCurrentPass("");
        setErr(message || null);
    };

    // Every way in ends here: the announcement, the fresh permissions, the page.
    const signedIn = async (text) => {
        tprmAlert.success("Signed in", text);
        await refetch();
        navigate("/Dashboard", { replace: true });
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
            const r = await apiPost("/api/tprm/login/Verifylogin", {
                username: email, password: pass,
                // Only meaningful when there is a code step to skip.
                remember: signinCfg.two_factor_enabled ? remember : false,
            });

            /* Signed in already - two-step is off, or this account is inside a
               live remember window. The server set the cookie rather than
               sending a code, so there is no second step to show. */
            if (r.next === "done") {
                await signedIn();
                return;
            }

            setMfaToken(r.mfaToken);
            setMfaEmail(r.maskedEmail || "");
            setResumed(false);
            setExpiresIn(Number(r.expiresIn) || 0);
            setResendIn(Number(r.resendIn) || 0);
            setCode("");
            setStep("mfa");
            tprmAlert.success("Check your email",
                `We sent a sign-in code to ${r.maskedEmail || "your work email"}.`);
        } catch (e2) {
            fail(e2);
        } finally {
            setBusy(false);
        }
    };

    const resend = async () => {
        setErr(null);
        setBusy(true);
        setSending(true);
        try {
            const r = await apiPost("/api/tprm/login/mfa/resend", { mfaToken });
            setExpiresIn(Number(r.expiresIn) || 0);
            setResendIn(Number(r.resendIn) || 0);
            setCode("");
            const to = r.maskedEmail || mfaEmail || "your work email";
            if (r.maskedEmail) setMfaEmail(r.maskedEmail);
            tprmAlert.success("Code resent", `A new code is on its way to ${to}.`);
        } catch (e2) {
            if (e2.message === "MFA_TOKEN_INVALID") {
                backToLogin("That took too long. Please sign in again.");
            } else {
                fail(e2);
            }
        } finally {
            setBusy(false);
            setSending(false);
        }
    };

    /* ------------------------------------------------------- step two */
    const submitCode = async (value) => {
        const entered = value !== undefined ? value : code;
        setErr(null);
        setBusy(true);
        try {
            const r = await apiPost("/api/tprm/login/mfa/verify", { mfaToken, code: entered });
            await signedIn(r && r.remembered
                ? `You will not be asked again for ${r.trustDays || signinCfg.trust_days} days.`
                : undefined);
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

    /* ----------------------------------------------- forgot password */
    /*
     * Three steps: address, mailed code, new password. The same two minute
     * code the sign-in second factor uses, from the same table but marked
     * with a different purpose, so a reset code can never be redeemed as a
     * sign-in and the other way round.
     *
     * The password being set lives in dadmin.employee, which every Dolluz
     * Corp app authenticates against - so this changes it for all of them,
     * and the screen says so rather than letting somebody find out later.
     */
    const startReset = async (e) => {
        e.preventDefault();
        setBusy(true); setErr(null);
        try {
            const r = await apiPost("/api/tprm/login/forgot/start", { username });
            setResetToken(r.resetToken);
            setMaskedReset(r.maskedEmail || "");
            setExpiresIn(Number(r.expiresIn) || 0);
            setCode("");
            setStep("forgotCode");
        } catch (ex) {
            setErr(ex.message || "Could not start the reset");
        } finally { setBusy(false); }
    };

    const verifyResetCode = async (e) => {
        e.preventDefault();
        setBusy(true); setErr(null);
        try {
            const r = await apiPost("/api/tprm/login/forgot/verify", { resetToken, code });
            setSetToken(r.setToken);
            setPwHelp(r.passwordHelp || "");
            setNewPass(""); setConfirmPass("");
            setStep("forgotPass");
        } catch (ex) {
            setErr(MESSAGES[ex.message] || ex.message || "That code was not accepted");
            if (ex.message === "OTP_BURNED" || ex.message === "OTP_EXPIRED") {
                setStep("forgot");
                setExpiresIn(0);
            }
        } finally { setBusy(false); }
    };

    const saveNewPassword = async (e) => {
        e.preventDefault();
        setBusy(true); setErr(null);
        try {
            await apiPost("/api/tprm/login/forgot/reset",
                { setToken, password: newPass, confirm: confirmPass });
            // A success is a receipt, not a warning, so it is a toast - not a
            // message in the sign-in form's error slot.
            tprmAlert.success("Password updated", "Sign in with your new password.");
            backToLogin(null);
        } catch (ex) {
            // The rule is long, so a rejected password shows the rule rather
            // than a code. Everything else goes through the shared map.
            setErr(ex.message === "PASSWORD_WEAK"
                ? (pwHelp || "That password does not meet the rule.")
                : MESSAGES[ex.message] || ex.message || "Could not change the password");
            if (ex.message === "SET_TOKEN_INVALID") setStep("forgot");
        } finally { setBusy(false); }
    };

    /* ----------------------------------------------- change password */
    // A 401 or 403 here means there is no dAssure session to change a password
    // on - somebody followed the link while signed out.
    const changeFail = (ex) => {
        if (ex.status === 401 || ex.status === 403) {
            setErr("You need to be signed in to change your password. Sign in, then choose "
                + "Change password on My Account.");
        } else if (ex.message === "PASSWORD_WEAK") {
            setErr(pwHelp || "That password does not meet the rule.");
        } else {
            setErr(MESSAGES[ex.message] || ex.message || "Could not change the password");
        }
    };

    const verifyCurrent = async (e) => {
        e.preventDefault();
        setBusy(true); setErr(null);
        try {
            const r = await apiPost("/api/tprm/login/change-password/verify",
                { currentPassword: currentPass });
            setPwHelp(r.passwordHelp || "");
            setNewPass(""); setConfirmPass("");
            setStep("changeNew");
        } catch (ex) {
            changeFail(ex);
        } finally { setBusy(false); }
    };

    const saveChanged = async (e) => {
        e.preventDefault();
        setBusy(true); setErr(null);
        try {
            // The current password goes again: the server re-checks it here, at
            // the point of write, not only on the step before.
            await apiPost("/api/tprm/login/change-password", {
                currentPassword: currentPass, newPassword: newPass, confirm: confirmPass,
            });
            setCurrentPass(""); setNewPass(""); setConfirmPass("");
            tprmAlert.success("Password updated",
                "It applies to every Dolluz Corp app, not just dAssure.");
            navigate("/My_Account", { replace: true });
        } catch (ex) {
            if (ex.message === "CURRENT_PASSWORD_WRONG") setStep("changePassword");
            changeFail(ex);
        } finally { setBusy(false); }
    };

    const p = panels[Math.min(i, panels.length - 1)] || {};
    // A banner is EITHER a full-panel image or gradient and copy. The file is
    // served by dAdmin, so its path is prefixed with dAdmin's base.
    const bannerImg = p.image_path ? `${DADMIN_API_BASE}${p.image_path}` : null;
    const gradient = `linear-gradient(140deg, ${p.gradient_from || "#0E1A2B"} 0%, `
        + `${p.gradient_to || "#1E3350"} 100%)`;
    const twoStepOn = signinCfg.two_factor_enabled === 1;

    // The left pane, identical on the sign-in step and the code step, so
    // moving between them changes only the form beside it.
    const bannerPane = (
        <div
            className={"tprm-login-panel" + (bannerImg ? " tprm-login-panel--img" : "")}
            style={bannerImg ? { backgroundImage: `url("${bannerImg}")` } : { background: gradient }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        >
            {/* An image banner fills the whole panel and nothing is painted
                over it. Only the dots remain, so it can still be driven. */}
            {!bannerImg && (
                <>
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
                        {p.headline && <h1 className="tprm-login-headline">{p.headline}</h1>}
                        {p.subline && <p className="tprm-login-sub">{p.subline}</p>}
                        <div className="tprm-login-rule" />
                        {/* No figures configured is a real answer: no row at
                            all, rather than an empty one holding the space. */}
                        {panelStats.length > 0 && (
                            <div className="tprm-login-stats">
                                {panelStats.map((st, n) => (
                                    <div key={`${n}-${st.label}`}>
                                        <div className="tprm-login-stat-n">{st.value}</div>
                                        <div className="tprm-login-stat-l">{st.label}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            <div className="tprm-login-dots">
                {panels.map((b, n) => (
                    <button
                        key={b.banner_id ?? n}
                        type="button"
                        // An image banner has no headline to name it by.
                        aria-label={`Show banner ${n + 1}${b.headline ? `: ${b.headline}` : ""}`}
                        className={n === i ? "on" : ""}
                        onClick={() => setI(n)}
                    />
                ))}
            </div>

            {/* The standalone tagline is gone: the lockup at the top of this
                same panel now carries "One Place . One Start . One Team" as
                part of the artwork, and printing it twice on one screen made
                the panel read as a mistake. */}
        </div>
    );

    /* ----------------------------------------- change password: current */
    if (step === "changePassword") {
        return (
            <Centered title="Change password" sub="Enter your current password to continue.">
                <form onSubmit={verifyCurrent}>
                    <div className="tprm-field">
                        <label htmlFor="tprm-curpass">Current password</label>
                        <div className="tprm-passwrap">
                            <input
                                id="tprm-curpass"
                                className="tprm-input"
                                type={showCurrent ? "text" : "password"}
                                autoComplete="current-password"
                                autoFocus
                                value={currentPass}
                                placeholder="Your current password"
                                onChange={e => { setCurrentPass(e.target.value); setErr(null); }}
                            />
                            <Reveal shown={showCurrent} onToggle={() => setShowCurrent(v => !v)} />
                        </div>
                    </div>
                    {err && <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err}</div>}
                    <button type="submit" className="tprm-btn primary wide"
                        disabled={!currentPass || busy}>
                        {busy ? "Checking…" : "Continue"}
                    </button>
                </form>
                <div className="tprm-access-link">
                    <button className="tprm-linkbtn" onClick={() => { setErr(null); setStep("forgot"); }}>
                        Forgot your current password?
                    </button>
                </div>
                <div className="tprm-access-link">
                    <button className="tprm-linkbtn" onClick={() => navigate("/My_Account")}>
                        Back to My Account
                    </button>
                </div>
            </Centered>
        );
    }

    /* ------------------------------------- change password: the new one */
    if (step === "changeNew") {
        const match = newPass.length > 0 && newPass === confirmPass;
        return (
            <Centered title="Choose a new password" sub={pwHelp}>
                <form onSubmit={saveChanged}>
                    <div className="tprm-field">
                        <label htmlFor="tprm-chnew">New password</label>
                        <div className="tprm-passwrap">
                            <input
                                id="tprm-chnew"
                                className="tprm-input"
                                type={showNew ? "text" : "password"}
                                autoComplete="new-password"
                                autoFocus
                                value={newPass}
                                placeholder="Your new password"
                                onChange={e => { setNewPass(e.target.value); setErr(null); }}
                            />
                            <Reveal shown={showNew} onToggle={() => setShowNew(v => !v)} />
                        </div>
                    </div>

                    <div className="tprm-field">
                        <label htmlFor="tprm-chconfirm">Confirm new password</label>
                        <div className="tprm-passwrap">
                            <input
                                id="tprm-chconfirm"
                                className="tprm-input"
                                type={showConfirm ? "text" : "password"}
                                autoComplete="new-password"
                                value={confirmPass}
                                placeholder="Type it again"
                                onChange={e => { setConfirmPass(e.target.value); setErr(null); }}
                            />
                            <Reveal shown={showConfirm} onToggle={() => setShowConfirm(v => !v)} />
                        </div>
                        {confirmPass.length > 0 && !match && (
                            <div className="tprm-hint" style={{ color: "var(--tprm-red)" }}>
                                The two passwords do not match
                            </div>
                        )}
                    </div>

                    {err && <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err}</div>}
                    <button type="submit" className="tprm-btn primary wide"
                        disabled={!match || busy}>
                        {busy ? "Saving…" : "Save password"}
                    </button>
                    <div className="tprm-note" style={{ marginTop: 18 }}>
                        This is your Dolluz Corp password, so it changes for every app, not just
                        dAssure.
                    </div>
                </form>
                <div className="tprm-access-link">
                    <button className="tprm-linkbtn"
                        onClick={() => { setErr(null); setStep("changePassword"); }}>
                        Back
                    </button>
                </div>
            </Centered>
        );
    }

    /* -------------------------------------------------- 1. the address */
    if (step === "forgot") {
        return (
            <Centered
                title="Forgot password"
                sub="Enter your work email and we will send a six digit code."
            >
                <form onSubmit={startReset}>
                    <div className="tprm-field">
                        <label htmlFor="tprm-forgot-email">Work email</label>
                        <input
                            id="tprm-forgot-email"
                            className="tprm-input"
                            type="email"
                            autoFocus
                            autoComplete="username"
                            value={username}
                            placeholder="name@dolluzcorp.com"
                            onChange={e => { setUsername(e.target.value); setErr(null); }}
                        />
                    </div>
                    {err && <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err}</div>}
                    <button type="submit" className="tprm-btn primary wide"
                        disabled={!username || busy}>
                        {busy ? "Sending…" : "Send code"}
                    </button>
                    <div className="tprm-note" style={{ marginTop: 18 }}>
                        The reply is identical whether or not the address exists, so this screen
                        cannot be used to find out who has an account.
                    </div>
                </form>
                <div className="tprm-access-link">
                    <button className="tprm-linkbtn" onClick={() => backToLogin(null)}>
                        Back to sign in
                    </button>
                </div>
            </Centered>
        );
    }

    /* ----------------------------------------------------- 2. the code */
    if (step === "forgotCode") {
        const dead = expiresIn <= 0;
        return (
            <Centered
                title="Enter the code"
                sub={`We sent a six digit code to ${maskedReset}. It expires in two minutes.`}
            >
                <form onSubmit={verifyResetCode}>
                    <div className="tprm-field">
                        <label htmlFor="tprm-reset-code">Six digit code</label>
                        <input
                            id="tprm-reset-code"
                            className="tprm-input"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            autoFocus
                            maxLength={6}
                            value={code}
                            placeholder="000000"
                            onChange={e => {
                                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                                setErr(null);
                            }}
                        />
                    </div>
                    <div className={"tprm-otp-clock" + (dead ? " out" : expiresIn <= 30 ? " low" : "")}>
                        {dead
                            ? "Code expired"
                            : <>Expires in <span className="mono">{clock(expiresIn)}</span></>}
                    </div>
                    {err && <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err}</div>}
                    <button type="submit" className="tprm-btn primary wide"
                        disabled={code.length !== 6 || dead || busy}>
                        {busy ? "Checking…" : "Continue"}
                    </button>
                </form>
                <div className="tprm-access-link">
                    <button className="tprm-linkbtn" onClick={() => { setErr(null); setStep("forgot"); }}>
                        Use a different address, or send another code
                    </button>
                </div>
            </Centered>
        );
    }

    /* --------------------------------------------- 3. the new password */
    if (step === "forgotPass") {
        const match = newPass.length > 0 && newPass === confirmPass;
        return (
            <Centered title="Choose a new password" sub={pwHelp}>
                <form onSubmit={saveNewPassword}>
                    <div className="tprm-field">
                        <label htmlFor="tprm-newpass">New password</label>
                        <div className="tprm-passwrap">
                            <input
                                id="tprm-newpass"
                                className="tprm-input"
                                type={showNew ? "text" : "password"}
                                autoComplete="new-password"
                                autoFocus
                                value={newPass}
                                placeholder="Your new password"
                                onChange={e => { setNewPass(e.target.value); setErr(null); }}
                            />
                            <Reveal shown={showNew} onToggle={() => setShowNew(v => !v)} />
                        </div>
                    </div>

                    <div className="tprm-field">
                        <label htmlFor="tprm-confirmpass">Confirm new password</label>
                        <div className="tprm-passwrap">
                            <input
                                id="tprm-confirmpass"
                                className="tprm-input"
                                type={showConfirm ? "text" : "password"}
                                autoComplete="new-password"
                                value={confirmPass}
                                placeholder="Type it again"
                                onChange={e => { setConfirmPass(e.target.value); setErr(null); }}
                            />
                            <Reveal shown={showConfirm} onToggle={() => setShowConfirm(v => !v)} />
                        </div>
                        {confirmPass.length > 0 && !match && (
                            <div className="tprm-hint" style={{ color: "var(--tprm-red)" }}>
                                The two passwords do not match
                            </div>
                        )}
                    </div>

                    {err && <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err}</div>}
                    <button type="submit" className="tprm-btn primary wide"
                        disabled={!match || busy}>
                        {busy ? "Saving…" : "Save password"}
                    </button>
                    <div className="tprm-note" style={{ marginTop: 18 }}>
                        This is your Dolluz Corp password, so it changes for every app, not just
                        dAssure.
                        {twoStepOn && ` Any live "remember for ${signinCfg.trust_days} days" window `
                            + "ends here too, so the next sign-in asks for a code again."}
                    </div>
                </form>
            </Centered>
        );
    }

    /* ---------------------------------------------------- two factor */
    // The same two panes as the sign-in step, matching dAttendance's "Enter the
    // code": the countdown in the lede, one wide field, Back and Send a new
    // code on one row, no auto-submit.
    if (step === "mfa") {
        const expired = expiresIn <= 0;
        return (
            <div className="tprm-login">
                {bannerPane}

                <div className="tprm-login-form">
                    <div className="tprm-login-formbox">
                        <div className="tprm-login-formlock"><LogoLock sm /></div>
                        <h2>Enter the code</h2>
                        <p className="tprm-login-formsub">
                            {resumed && "You are signed in to another Dolluz Corp app. "}
                            We sent a 6-digit code to <strong>{mfaEmail || "your work email"}</strong>.{" "}
                            {expired
                                ? <>That code has expired — send a new one.</>
                                : <>It expires in <strong className="tprm-login-count">{clock(expiresIn)}</strong>.</>}
                        </p>

                        <form onSubmit={e => { e.preventDefault(); submitCode(); }}>
                            <div className="tprm-field">
                                <label htmlFor="tprm-mfa-code">Verification code</label>
                                <input
                                    id="tprm-mfa-code"
                                    className="tprm-input tprm-input--otp"
                                    placeholder="••••••"
                                    inputMode="numeric"
                                    maxLength={6}
                                    autoComplete="one-time-code"
                                    autoFocus
                                    value={code}
                                    onChange={e => {
                                        setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                                        setErr(null);
                                    }}
                                />
                            </div>

                            <div className="tprm-login-optrow">
                                <button type="button" className="tprm-linkbtn tprm-login-quiet"
                                    onClick={() => backToLogin(null)}>
                                    ← Back
                                </button>
                                <button
                                    type="button"
                                    className="tprm-linkbtn tprm-login-forgot"
                                    onClick={resend}
                                    disabled={busy || resendIn > 0}
                                >
                                    {sending ? "Sending…" : resendIn > 0 ? `Resend in ${resendIn}s` : "Send a new code"}
                                </button>
                            </div>

                            {err && <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err}</div>}

                            <button
                                type="submit"
                                className="tprm-btn primary wide"
                                disabled={busy || expired || code.length < 6}
                            >
                                {busy && !sending ? "Verifying…" : "Verify and sign in"}
                            </button>
                        </form>

                        <div className="tprm-login-foot">
                            Didn’t get it? Check your spam folder. The code is only valid for a
                            couple of minutes, and never ask anyone to read it to them.
                        </div>

                        <div className="tprm-login-support">
                            Trouble signing in? Contact <a href="mailto:admin@dolluzcorp.com">admin@dolluzcorp.com</a>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    /* --------------------------------------------------------- login */
    return (
        <div className="tprm-login">
            {bannerPane}

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
                                <Reveal shown={showPass} onToggle={() => setShowPass(v => !v)} />
                            </div>
                            {caps && (
                                <div className="tprm-hint" style={{ color: "var(--tprm-amber)" }}>
                                    Caps Lock is on
                                </div>
                            )}
                        </div>

                        <div className="tprm-login-optrow">
                            {/* Hidden when dAdmin has two-step off - there is then no
                                code to skip. The window is account-level, hence
                                "any browser". Ticking it here is carried through to
                                the code step, which is where it is applied. */}
                            {twoStepOn && (
                                <label className="tprm-login-remember">
                                    <input
                                        type="checkbox"
                                        checked={remember}
                                        onChange={e => setRemember(e.target.checked)}
                                    />
                                    Remember for {signinCfg.trust_days} days
                                    <span
                                        className="tprm-login-remember-note"
                                        title={`Skips the emailed code for ${signinCfg.trust_days} days `
                                            + "on this account, in any browser on any machine - "
                                            + "not just this one."}
                                    >
                                        any browser
                                    </span>
                                </label>
                            )}
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

                    {twoStepOn && (
                        <div className="tprm-login-foot">
                            Two factor is required at the next step for every account, internal and
                            external.
                        </div>
                    )}

                    <div className="tprm-login-support">
                        Trouble signing in? Contact <a href="mailto:admin@dolluzcorp.com">admin@dolluzcorp.com</a>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default TPRMLogin;
