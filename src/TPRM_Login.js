import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { apiFetch, apiPost } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import logo_dolluz from "./assets/img/DOLLUZ_CORP.png";
import "./TPRM_Login.css";

// Fallback only. The real banners live in the banner table and are served by
// /api/tprm/banners/public, so they can be changed without a deploy. These
// three are used when that call cannot be reached, which is the one moment
// the sign-in screen still has to render: the database being down.
const FALLBACK = [
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

// Server codes -> what the person reading the screen needs to do about it.
// Anything not listed falls through to the message the server sent.
const MESSAGES = {
    EMAIL_NOT_FOUND: { field: "email", text: "No account exists with that email address" },
    INVALID_CREDENTIALS: { field: "password", text: "That password is not correct" },
    MFA_INVALID: { field: "code", text: "That code is not correct" },
    OTP_NOT_SENT: { text: "No code is waiting. Send a new one to continue" },
    RESEND_LIMIT: { text: "Too many codes sent. Sign in again to start over" },
    NO_ENGAGEMENT: {
        text: "Your account is valid, but you have not been assigned to a client engagement in dTprm yet. "
            + "Ask a Practice Head or Engagement Manager to grant you a role.",
    },
};

function TPRMLogin() {
    const navigate = useNavigate();
    const location = useLocation();
    const { refetch } = useAccess();
    const [i, setI] = useState(0);
    const [panels, setPanels] = useState(FALLBACK);
    const [hover, setHover] = useState(false);

    // password -> mfa -> Dashboard.
    // A password on its own never reaches the Dashboard: it mails a six digit
    // code and produces the token that the code step spends.
    const [step, setStep] = useState("password");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [mfaToken, setMfaToken] = useState(null);
    const [code, setCode] = useState("");
    // Where the code went, and the two clocks the screen counts down: how long
    // this code is good for, and when Resend becomes clickable again.
    const [sentTo, setSentTo] = useState("");
    const [expiresIn, setExpiresIn] = useState(0);
    const [resendIn, setResendIn] = useState(0);

    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const [showPass, setShowPass] = useState(false);
    const [caps, setCaps] = useState(false);
    const codeRef = useRef(null);
    // Why a protected route sent us back, when it did. Shown once, then
    // cleared so a refresh does not keep repeating it.
    const [bounced, setBounced] = useState(
        () => (location.state && location.state.message) || null);

    useEffect(() => {
        let live = true;
        apiFetch("/api/tprm/banners/public")
            .then(r => (r.ok ? r.json() : []))
            .then(rows => { if (live && rows.length) { setPanels(rows); setI(0); } })
            .catch(() => { /* FALLBACK already on screen */ });
        return () => { live = false; };
    }, []);

    // Someone already signed into dAdmin or Inside D has proved who they are,
    // but not to this product. Rather than making them retype a password they
    // have already given, resume at the code step.
    useEffect(() => {
        let live = true;
        apiPost("/api/tprm/login/mfa/resume", {})
            .then(r => {
                if (!live || !r || !r.mfaToken) return;
                setMfaToken(r.mfaToken);
                applySend(r);
                setStep("mfa");
            })
            .catch(() => { /* no sibling session: the password step is correct */ });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Pause while the pointer is on the panel, so a reader is not interrupted.
    useEffect(() => {
        if (hover || panels.length < 2) return;
        const t = setInterval(() => setI(x => (x + 1) % panels.length), 3000);
        return () => clearInterval(t);
    }, [hover, panels.length]);

    // The code field is the only thing on screen at that point, so put the
    // caret in it rather than making the user click.
    useEffect(() => {
        if (step === "mfa" && codeRef.current) codeRef.current.focus();
    }, [step]);

    // One interval drives both clocks. It runs only on the code step, and only
    // while there is something left to count, so the screen is not re-rendering
    // once a second for no reason.
    useEffect(() => {
        if (step !== "mfa") return;
        if (expiresIn <= 0 && resendIn <= 0) return;
        const t = setInterval(() => {
            setExpiresIn(v => (v > 0 ? v - 1 : 0));
            setResendIn(v => (v > 0 ? v - 1 : 0));
        }, 1000);
        return () => clearInterval(t);
    }, [step, expiresIn, resendIn]);

    /** Starts both clocks from what the server just told us. */
    const applySend = (r) => {
        setSentTo(r.maskedEmail || "");
        setExpiresIn(Number(r.expiresIn) || 0);
        setResendIn(Number(r.resendIn) || 0);
        setCode("");
    };

    const fail = (e2) => {
        const known = MESSAGES[e2.message];
        if (known) setErr({ field: known.field, message: known.text });
        else setErr({ message: e2.message || "Could not sign you in" });
    };

    /** Back to the start, keeping the email so it does not have to be retyped. */
    const resetToPassword = (message) => {
        setStep("password");
        setMfaToken(null); setCode(""); setSentTo("");
        setExpiresIn(0); setResendIn(0); setPassword("");
        setErr(message ? { message } : null);
    };

    /* ------------------------------------------------------- step one */
    const submitPassword = async (e) => {
        if (e) e.preventDefault();
        setErr(null);
        if (!username || !password) {
            setErr({ message: "Enter your email address and password" });
            return;
        }
        setBusy(true);
        try {
            const r = await apiPost("/api/tprm/login/Verifylogin", { username, password });
            setMfaToken(r.mfaToken);
            applySend(r);
            setStep("mfa");
        } catch (e2) {
            fail(e2);
        } finally {
            setBusy(false);
        }
    };

    /* ------------------------------------------------------- step two */
    const submitCode = async (e) => {
        if (e) e.preventDefault();
        setErr(null);
        setBusy(true);
        try {
            await apiPost("/api/tprm/login/mfa/verify", { mfaToken, code });
            await finish();
        } catch (e2) {
            if (e2.message === "MFA_TOKEN_INVALID") {
                resetToPassword("That took too long. Please sign in again.");
            } else if (e2.message === "OTP_EXPIRED") {
                // Not an error to apologise for - the countdown said it would
                // happen. Zero the clock so the Resend button takes over.
                setExpiresIn(0); setResendIn(0); setCode("");
                setErr({ message: "That code has expired. Send a new one to continue." });
            } else if (e2.message === "OTP_BURNED") {
                setExpiresIn(0); setResendIn(0); setCode("");
                setErr({ message: "Three wrong codes, so that one is no longer valid. Send a new one." });
            } else if (e2.message === "RESEND_LIMIT") {
                resetToPassword("Too many codes sent. Please sign in again.");
            } else {
                fail(e2);
                setCode("");
            }
        } finally {
            setBusy(false);
        }
    };

    const resend = async () => {
        setErr(null);
        setBusy(true);
        try {
            applySend(await apiPost("/api/tprm/login/mfa/resend", { mfaToken }));
        } catch (e2) {
            if (e2.message === "RESEND_TOO_SOON") {
                setErr({ message: "A code was just sent. Give it a moment." });
            } else if (e2.message === "MFA_TOKEN_INVALID") {
                resetToPassword("That took too long. Please sign in again.");
            } else {
                fail(e2);
            }
        } finally {
            setBusy(false);
        }
    };

    const finish = async () => {
        await refetch();
        navigate("/Dashboard", { replace: true });
    };

    // Guard the index: the fetched list can be shorter than the fallback.
    const p = panels[Math.min(i, panels.length - 1)] || {};
    const gradient = `linear-gradient(140deg, ${p.gradient_from || "#0E1A2B"} 0%, `
        + `${p.gradient_to || "#1E3350"} 100%)`;

    const codeReady = code.length === 6 && expiresIn > 0;
    // 1:47, not 107 seconds. Nobody counts in seconds past sixty.
    const mmss = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;

    return (
        <div className="tprm-login">
            <div
                className="tprm-login-panel"
                style={{ background: gradient }}
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
            >
                <div className="tprm-login-brandblock">
                    <img src={logo_dolluz} alt="Dolluz Corp" className="tprm-login-logomark" />
                </div>
                <div className="tprm-login-panelbody">
                    {p.tag_label && <div className="tprm-login-tag">{p.tag_label}</div>}
                    <h1 className="tprm-login-headline">{p.headline}</h1>
                    <p className="tprm-login-sub">{p.subline}</p>
                    <div className="tprm-login-rule" />
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
                </div>
            </div>

            <div className="tprm-login-form">
                <div className="tprm-login-formbox">
                    <div className="tprm-login-formbrand">TPRM TOOLKIT</div>

                    {/* ------------------------------------------ step one */}
                    {step === "password" && (
                        <>
                            <h2>Sign in</h2>
                            <p className="tprm-login-formsub">
                                Use the same credentials you use for the other Dolluz Corp apps.
                            </p>

                            <form onSubmit={submitPassword}>
                                <div className="tprm-field">
                                    <label htmlFor="tprm-email">Email address</label>
                                    <input
                                        id="tprm-email"
                                        className="tprm-input"
                                        autoFocus
                                        type="email"
                                        autoComplete="username"
                                        value={username}
                                        onChange={e => { setUsername(e.target.value); setErr(null); setBounced(null); }}
                                        placeholder="you@dolluzcorp.com"
                                    />
                                    {err && err.field === "email" && (
                                        <div className="tprm-login-err">{err.message}</div>
                                    )}
                                </div>

                                <div className="tprm-field">
                                    <label htmlFor="tprm-pass">Password</label>
                                    <div className="tprm-passwrap">
                                        <input
                                            id="tprm-pass"
                                            className="tprm-input"
                                            type={showPass ? "text" : "password"}
                                            autoComplete="current-password"
                                            value={password}
                                            onChange={e => { setPassword(e.target.value); setErr(null); setBounced(null); }}
                                            onKeyUp={e => setCaps(e.getModifierState && e.getModifierState("CapsLock"))}
                                            onBlur={() => setCaps(false)}
                                        />
                                        {/* type=button so it never submits the form */}
                                        <button
                                            type="button"
                                            className="tprm-passtoggle"
                                            onClick={() => setShowPass(v => !v)}
                                            aria-label={showPass ? "Hide password" : "Show password"}
                                            aria-pressed={showPass}
                                            title={showPass ? "Hide password" : "Show password"}
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
                                    {err && err.field === "password" && (
                                        <div className="tprm-login-err">{err.message}</div>
                                    )}
                                </div>

                                <div className="tprm-login-hint2">
                                    Two factor is required at the next step
                                </div>

                                {bounced && !err && (
                                    <div className="tprm-note warn" style={{ marginBottom: 14 }}>
                                        {bounced}
                                    </div>
                                )}

                                {err && !err.field && (
                                    <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err.message}</div>
                                )}

                                <button type="submit" className="tprm-btn primary wide" disabled={busy}>
                                    {busy ? "Checking..." : "Continue"}
                                </button>
                            </form>

                            <div className="tprm-login-note">
                                This is an internal tool. Suppliers never sign in here - they receive a
                                workbook by email and return it the same way.
                            </div>
                        </>
                    )}

                    {/* ------------------------------------------ step two */}
                    {step === "mfa" && (
                        <>
                            <h2>Two factor</h2>
                            <p className="tprm-login-formsub">
                                We sent a six digit code to <b>{sentTo || "your work email"}</b>.
                                Enter it below to finish signing in.
                            </p>

                            <form onSubmit={submitCode}>
                                <div className="tprm-field">
                                    <div className="tprm-codehead">
                                        <label htmlFor="tprm-code">Six digit code</label>
                                        <span
                                            className={"tprm-timer" + (expiresIn === 0 ? " out"
                                                : expiresIn <= 30 ? " low" : "")}
                                            role="timer"
                                            aria-live="off"
                                        >
                                            {expiresIn > 0 ? mmss(expiresIn) : "expired"}
                                        </span>
                                    </div>
                                    <input
                                        id="tprm-code"
                                        ref={codeRef}
                                        className="tprm-input tprm-mfa-code"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        maxLength={6}
                                        placeholder="000000"
                                        disabled={expiresIn === 0}
                                        value={code}
                                        onChange={e => {
                                            setCode(e.target.value.replace(/\D/g, ""));
                                            setErr(null);
                                        }}
                                    />
                                    {err && err.field === "code" && (
                                        <div className="tprm-login-err">{err.message}</div>
                                    )}
                                </div>

                                {err && !err.field && (
                                    <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err.message}</div>
                                )}

                                <button
                                    type="submit"
                                    className="tprm-btn primary wide"
                                    disabled={busy || !codeReady}
                                >
                                    {busy ? "Verifying..." : "Verify and continue"}
                                </button>
                            </form>

                            <div className="tprm-login-steplinks">
                                <button
                                    type="button"
                                    className="tprm-linkbtn"
                                    onClick={resend}
                                    disabled={busy || resendIn > 0}
                                >
                                    {resendIn > 0
                                        ? `Resend code in ${mmss(resendIn)}`
                                        : "Resend code"}
                                </button>
                                <button
                                    type="button"
                                    className="tprm-linkbtn"
                                    onClick={() => resetToPassword(null)}
                                >
                                    Back to sign in
                                </button>
                            </div>

                            <div className="tprm-note warn" style={{ marginTop: 18 }}>
                                Mandatory for every role. The code lasts two minutes and can be
                                used once. Three wrong tries and you will need a new one.
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default TPRMLogin;
