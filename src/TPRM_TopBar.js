// The top bar: what page you are on, which client you are working on, and the
// two account actions.
//
// The title comes from NAV_ITEMS in the sidebar rather than from each page, so
// the menu row and the heading can never drift apart.

import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NAV_ITEMS, navLabel } from "./left_navbar";
import { roleCode } from "./utils/tprmRoles";
import TPRMSpec, { specIdFor } from "./TPRM_Spec";
import { useAccess } from "./utils/AccessContext";
import { apiFetch } from "./utils/api";
import "./TPRM_TopBar.css";
import TPRMSelect from "./TPRM_Select";

function TPRMTopBar() {
    const { tenant, tenants, setTenant } = useAccess();
    const location = useLocation();
    const navigate = useNavigate();
    const code = roleCode(tenant);
    const [specOpen, setSpecOpen] = useState(false);
    // No button on a screen with nothing to say about itself.
    const hasSpec = Boolean(specIdFor(location.pathname, location.search));

    // Longest match wins, so /Assessments/12 still titles as Assessments. The
    // label comes from the menu, including its per-role rename, so the heading
    // always reads the same word the person clicked.
    const path = location.pathname.toLowerCase();
    const match = NAV_ITEMS
        .filter(i => path === i.to.toLowerCase() || path.startsWith(i.to.toLowerCase() + "/"))
        .sort((a, b) => b.to.length - a.to.length)[0];
    const title = match ? navLabel(match, code)
        : path === "/my_account" ? "My Account"
            : path === "/vendor_population" ? "Population pipeline"
                : "";

    const signOut = async () => {
        await apiFetch("/api/tprm/login/logout", { method: "POST" }).catch(() => {});
        localStorage.removeItem("dTprm_tenant");
        navigate("/login", { replace: true });
        window.location.reload();
    };

    return (
        <>
        <header className="tprm-topbar">
            <div className="tprm-topbar-title">{title}</div>
            <div className="tprm-topbar-spacer" />

            <label className="tprm-topbar-label" htmlFor="tprm-topbar-client">Client</label>
            <TPRMSelect
                id="tprm-topbar-client"
                className="tprm-topbar-select"
                value={tenant ? tenant.tenant_id : ""}
                onChange={(v) => setTenant(v)}
                disabled={tenants.length === 0}
                placeholder={tenants.length === 0 ? "No client assigned" : "— choose a client —"}
                ariaLabel="Client"
                options={tenants.map(t => ({ value: t.tenant_id, label: t.tenant_name }))}
            />

            {hasSpec && (
                <button
                    className="tprm-btn sm"
                    onClick={() => setSpecOpen(o => !o)}
                    aria-expanded={specOpen}
                >
                    {specOpen ? "Hide spec" : "Show spec"}
                </button>
            )}
            <button className="tprm-btn sm" onClick={() => navigate("/My_Account")}>
                My Account
            </button>
            <button className="tprm-btn sm" onClick={signOut}>
                Sign out
            </button>
        </header>

        <TPRMSpec open={specOpen} onClose={() => setSpecOpen(false)} />
        </>
    );
}

export default TPRMTopBar;
