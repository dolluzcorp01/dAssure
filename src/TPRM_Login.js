import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { apiPost } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import logo_eagle from "./assets/img/logo_eagle.png";
import "./TPRM_Login.css";

// Rotating panel copy. Static rather than database driven, because there is
// no public side to this product - only staff ever see this screen.
const PANELS = [
    {
        tag: "EVIDENCE",
        headline: "An assertion is not evidence",
        sub: "A control claimed without proof is recorded as Not Evidenced and scores accordingly. The rule enforces itself.",
    },
    {
        tag: "SEGREGATION",
        headline: "Nobody approves their own work",
        sub: "The reviewer can never be the assessor. Enforced in the database, not only in the interface.",
    },
    {
        tag: "TRACEABILITY",
        headline: "Every score traces to an answer",
        sub: "Residual risk is derived from inherent risk and control effectiveness. It is never typed in by hand.",
    },
];

function TPRMLogin() {
    const navigate = useNavigate();
    const { refetch } = useAccess();
    const [i, setI] = useState(0);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const [showPass, setShowPass] = useState(false);
    const [caps, setCaps] = useState(false);

    useEffect(() => {
        const t = setInterval(() => setI(x => (x + 1) % PANELS.length), 6000);
        return () => clearInterval(t);
    }, []);

    const submit = async (e) => {
        if (e) e.preventDefault();
        setErr(null);
        if (!username || !password) {
            setErr({ message: "Enter your email address and password" });
            return;
        }
        setBusy(true);
        try {
            await apiPost("/api/tprm/login/Verifylogin", { username, password });
            await refetch();
            navigate("/Dashboard", { replace: true });
        } catch (e2) {
            // The server returns distinct codes so we can point at the right
            // field rather than saying "login failed" and leaving them guessing.
            if (e2.message === "EMAIL_NOT_FOUND") {
                setErr({ field: "email", message: "No account exists with that email address" });
            } else if (e2.message === "INVALID_CREDENTIALS") {
                setErr({ field: "password", message: "That password is not correct" });
            } else if (e2.message === "NO_ENGAGEMENT") {
                setErr({
                    message: "Your account is valid, but you have not been assigned to a client engagement in dTprm yet. "
                        + "Ask a Practice Head or Engagement Manager to grant you a role.",
                });
            } else {
                setErr({ message: e2.message || "Could not sign you in" });
            }
        } finally {
            setBusy(false);
        }
    };

    const p = PANELS[i];

    return (
        <div className="tprm-login">
            <div className="tprm-login-panel">
                <div className="tprm-login-brand">DOLLUZ CORP</div>
                <div className="tprm-login-panelbody">
                    <div className="tprm-login-tag">{p.tag}</div>
                    <h1 className="tprm-login-headline">{p.headline}</h1>
                    <p className="tprm-login-sub">{p.sub}</p>
                </div>
                <div className="tprm-login-dots">
                    {PANELS.map((_, n) => (
                        <button
                            key={n}
                            type="button"
                            aria-label={`Panel ${n + 1}`}
                            className={n === i ? "on" : ""}
                            onClick={() => setI(n)}
                        />
                    ))}
                </div>
                <div className="tprm-login-foot">Third Party Risk Management Toolkit</div>
            </div>

            <div className="tprm-login-form">
                <div className="tprm-login-formbox">
                    <img src={logo_eagle} alt="Dolluz Corp" className="tprm-login-logo" />
                    <h2>Sign in</h2>
                    <p className="tprm-login-formsub">
                        Use the same credentials you use for the other Dolluz Corp apps.
                    </p>

                    <form onSubmit={submit}>
                        <div className="tprm-field">
                            <label htmlFor="tprm-email">Email address</label>
                            <input
                                id="tprm-email"
                                className="tprm-input"
                                autoFocus
                                type="email"
                                autoComplete="username"
                                value={username}
                                onChange={e => { setUsername(e.target.value); setErr(null); }}
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
                                    onChange={e => { setPassword(e.target.value); setErr(null); }}
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
                                <div className="tprm-hint" style={{ color: "var(--tprm-orange)" }}>
                                    Caps Lock is on
                                </div>
                            )}
                            {err && err.field === "password" && (
                                <div className="tprm-login-err">{err.message}</div>
                            )}
                        </div>

                        {err && !err.field && (
                            <div className="tprm-note danger" style={{ marginBottom: 14 }}>{err.message}</div>
                        )}

                        <button
                            type="submit"
                            className="tprm-btn primary"
                            style={{ width: "100%", padding: 11 }}
                            disabled={busy}
                        >
                            {busy ? "Signing in..." : "Sign in"}
                        </button>
                    </form>

                    <div className="tprm-login-note">
                        This is an internal tool. Suppliers never sign in here - they receive a
                        workbook by email and return it the same way.
                    </div>
                </div>
            </div>
        </div>
    );
}

export default TPRMLogin;
