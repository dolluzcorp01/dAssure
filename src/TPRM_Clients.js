import React, { useEffect, useState, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiJson } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_Clients.css";

function TPRMClients() {
    const { hasPerm, setupMode } = useAccess();
    const location = useLocation();
    const navigate = useNavigate();
    const [rows, setRows] = useState(null);

    const load = useCallback(() => {
        apiJson("/api/tprm/clients/list").then(setRows).catch(e => { setRows([]); tprmAlert.apiError(e); });
    }, []);

    useEffect(() => { load(); }, [load]);

    // Arriving from a "create a client" button anywhere else goes straight into
    // the wizard - landing on the page and having to find the button again is
    // the same dead end one step further along. The flag is cleared on the way
    // so a Back out of the wizard does not bounce you into it again.
    useEffect(() => {
        if (location.state && location.state.openForm) {
            navigate(location.pathname, { replace: true, state: {} });
            navigate("/Clients/new");
        }
    }, [location, navigate]);


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
                            onClick={() => navigate("/Clients/new")}
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
                            /* The whole row is clickable for convenience, but the
                               name is a real link - that is what a keyboard tabs
                               to and what a screen reader announces. */
                            <tr key={t.tenant_id} className="tprm-clients-row"
                                onClick={() => navigate(`/Clients/${t.tenant_id}`)}>
                                <td className="num" style={{ fontWeight: 700 }}>{t.tenant_code}</td>
                                <td>
                                    <Link className="tprm-clients-name"
                                        to={`/Clients/${t.tenant_id}`}
                                        onClick={e => e.stopPropagation()}>
                                        {t.tenant_name}
                                    </Link>
                                </td>
                                <td style={{ color: "var(--tprm-muted)" }}>
                                    {t.sector_name || t.default_sector || "-"}
                                </td>
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

        </div>
    );
}

export default TPRMClients;
