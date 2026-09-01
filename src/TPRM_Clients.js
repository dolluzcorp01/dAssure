import React, { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiJson, apiPost } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_Clients.css";

function TPRMClients() {
    const { hasPerm, refetch, setupMode } = useAccess();
    const location = useLocation();
    const navigate = useNavigate();
    const [rows, setRows] = useState(null);
    const [sectors, setSectors] = useState([]);
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        apiJson("/api/tprm/clients/list").then(setRows).catch(e => { setRows([]); tprmAlert.apiError(e); });
    }, []);

    useEffect(() => { load(); }, [load]);

    // Arriving from a "create a client" button anywhere else opens the form
    // straight away - landing on the page and having to find the button again
    // is the same dead end one step further along. The flag is then cleared so
    // a refresh or a Back does not reopen it.
    useEffect(() => {
        if (location.state && location.state.openForm) {
            setForm({ code: "", name: "", sector: "OILGAS" });
            navigate(location.pathname, { replace: true, state: {} });
        }
    }, [location, navigate]);
    useEffect(() => { apiJson("/api/tprm/library/sectors").then(setSectors).catch(() => {}); }, []);

    const create = async () => {
        setSaving(true);
        try {
            await apiPost("/api/tprm/clients/create", {
                tenantCode: form.code, tenantName: form.name, defaultSector: form.sector,
            });
            setForm(null);
            load();
            // The creator gets a role on the client they just made - Practice
            // Head on the very first one, Engagement Manager after that - so the
            // sidebar and the whole permission set have to be reloaded.
            const wasFirstRun = setupMode;
            await refetch();
            if (wasFirstRun) {
                // First run ends here. Say what the new Practice Head can now do,
                // rather than leaving them to find it.
                tprmAlert.info(
                    "You are the Practice Head",
                    `${form.name} is set up and you now hold every permission on it. `
                    + "Next: add your team under Configuration, Users and Roles, or start "
                    + "loading suppliers under Vendor Population.");
            } else {
                tprmAlert.success("Client onboarded");
            }
        } catch (e) {
            tprmAlert.apiError(e);
        } finally {
            setSaving(false);
        }
    };

    if (!rows) return <div className="tprm-loading">Loading clients...</div>;

    return (
        <div className="tprm-page">
            {setupMode && (
                <div className="tprm-note" style={{ marginBottom: 16 }}>
                    <strong>First run.</strong> Nobody has been assigned to a client yet, so
                    you are being let in as a dAdmin administrator to get things started.
                    Onboard your first client below - you become its Practice Head
                    automatically, and can then grant everyone else their roles from
                    Configuration &rarr; Users and Roles. This notice disappears once
                    that first client exists.
                </div>
            )}

            <div className="tprm-page-head">
                <div>
                    <h1 className="tprm-page-title">Clients</h1>
                    <div className="tprm-page-sub">
                        Each client is a separate engagement. Its own sector sets the regulatory
                        overlay, not the questionnaire its suppliers receive.
                    </div>
                </div>
                {hasPerm("client.create") && (
                    <div className="tprm-page-actions">
                        {/* Gold is the confirming action across the product -
                            Import, Approve, Save methodology, Onboard. Navy
                            navigates; gold commits. This one commits. */}
                        <button
                            className="tprm-btn gold"
                            onClick={() => setForm({ code: "", name: "", sector: "OILGAS" })}
                        >
                            Onboard client
                        </button>
                    </div>
                )}
            </div>

            <div className="tprm-card flush">
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Code</th><th>Client</th><th>Primary sector</th>
                            <th>Third parties</th><th>Open findings</th><th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(t => (
                            <tr key={t.tenant_id}>
                                <td className="num" style={{ fontWeight: 700 }}>{t.tenant_code}</td>
                                <td style={{ fontWeight: 600 }}>{t.tenant_name}</td>
                                <td style={{ color: "var(--tprm-muted)" }}>{t.default_sector || "-"}</td>
                                <td className="num">{t.third_parties}</td>
                                <td className="num">{t.open_findings}</td>
                                <td>
                                    <span className={"tprm-chip " + (t.status === "active" ? "green" : "grey")}>
                                        {t.status}
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={6} className="tprm-empty">
                                You are not assigned to any client yet.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Deliberately no dismiss-on-backdrop-click: a stray click outside
                must never discard a part-filled form. Cancel is the way out. */}
            {form && (
                <div className="tprm-modal-backdrop">
                    <div
                        className="tprm-modal"
                        onKeyDown={e => {
                            if (e.key !== "Enter" || e.target.tagName === "TEXTAREA") return;
                            if (saving || !form.code || !form.name) return;
                            e.preventDefault();
                            create();
                        }}
                    >
                        <div className="tprm-modal-head">
                            <div>
                                <div className="tprm-modal-title">Onboard a client</div>
                                <div className="tprm-modal-sub">Nothing is written until you confirm</div>
                            </div>
                            <button
                                className="tprm-modal-close"
                                aria-label="Close"
                                onClick={() => setForm(null)}
                                disabled={saving}
                            >
                                &times;
                            </button>
                        </div>
                        <div className="tprm-modal-body">
                            <div className="tprm-field">
                                <label>Legal entity name</label>
                                <input
                                    className="tprm-input"
                                    autoFocus
                                    value={form.name}
                                    placeholder="Petroleum Development Oman"
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                />
                            </div>
                            <div className="tprm-field">
                                <label>Client code</label>
                                <input
                                    className="tprm-input"
                                    value={form.code}
                                    placeholder="PDO"
                                    onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                                />
                                <div className="tprm-hint">
                                    Two to eight characters, letters and digits. It appears in every
                                    document reference we issue, so it cannot be changed later.
                                </div>
                            </div>
                            <div className="tprm-field">
                                <label>Primary sector</label>
                                <select
                                    className="tprm-select"
                                    value={form.sector}
                                    onChange={e => setForm({ ...form, sector: e.target.value })}
                                >
                                    {sectors.map(s => (
                                        <option key={s.sector_code} value={s.sector_code}>{s.sector_name}</option>
                                    ))}
                                </select>
                                <div className="tprm-hint">
                                    The client's own industry. This drives the regulatory overlay.
                                    Each supplier still gets a questionnaire matched to its own sector.
                                </div>
                            </div>
                        </div>
                        <div className="tprm-modal-foot">
                            <button className="tprm-btn" onClick={() => setForm(null)} disabled={saving}>
                                Cancel
                            </button>
                            <button
                                className="tprm-btn gold"
                                onClick={create}
                                disabled={saving || !form.code || !form.name}
                            >
                                {saving ? "Creating..." : "Create client"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default TPRMClients;
