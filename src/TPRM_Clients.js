import React, { useEffect, useState, useCallback } from "react";
import { apiJson, apiPost } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_Clients.css";

function TPRMClients() {
    const { hasPerm, refetch } = useAccess();
    const [rows, setRows] = useState(null);
    const [sectors, setSectors] = useState([]);
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        apiJson("/api/tprm/clients/list").then(setRows).catch(e => { setRows([]); tprmAlert.apiError(e); });
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { apiJson("/api/tprm/library/sectors").then(setSectors).catch(() => {}); }, []);

    const create = async () => {
        setSaving(true);
        try {
            await apiPost("/api/tprm/clients/create", {
                tenantCode: form.code, tenantName: form.name, defaultSector: form.sector,
            });
            setForm(null);
            load();
            // The creator becomes Engagement Manager on the new client, so the
            // client list in the sidebar has to be reloaded too.
            await refetch();
            tprmAlert.success("Client onboarded");
        } catch (e) {
            tprmAlert.apiError(e);
        } finally {
            setSaving(false);
        }
    };

    if (!rows) return <div className="tprm-loading">Loading clients...</div>;

    return (
        <div className="tprm-page">
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
                        <button
                            className="tprm-btn primary"
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
                            <th>Code</th><th>Client</th><th>Their sector</th>
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
                    <div className="tprm-modal">
                        <div className="tprm-modal-head">
                            <div className="tprm-modal-title">Onboard a client</div>
                            <div className="tprm-modal-sub">Nothing is written until you confirm</div>
                        </div>
                        <div className="tprm-modal-body">
                            <div className="tprm-field">
                                <label>Legal entity name</label>
                                <input
                                    className="tprm-input"
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
                                <label>Their primary sector</label>
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
                                className="tprm-btn primary"
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
