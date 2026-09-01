// The top bar: what page you are on, which client you are working on, and the
// two account actions.
//
// The title comes from NAV_ITEMS in the sidebar rather than from each page, so
// the menu row and the heading can never drift apart.

import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NAV_ITEMS } from "./left_navbar";
import { useAccess } from "./utils/AccessContext";
import { apiFetch } from "./utils/api";
import "./TPRM_TopBar.css";

function TPRMTopBar() {
    const { tenant, tenants, setTenant } = useAccess();
    const location = useLocation();
    const navigate = useNavigate();

    // Longest match wins, so /Assessments/12 still titles as Assessments.
    const path = location.pathname.toLowerCase();
    const match = NAV_ITEMS
        .filter(([, to]) => path === to.toLowerCase() || path.startsWith(to.toLowerCase() + "/"))
        .sort((a, b) => b[1].length - a[1].length)[0];
    const title = match ? match[0] : (path === "/my_account" ? "My Account" : "");

    const signOut = async () => {
        await apiFetch("/api/tprm/login/logout", { method: "POST" }).catch(() => {});
        localStorage.removeItem("dTprm_tenant");
        navigate("/login", { replace: true });
        window.location.reload();
    };

    return (
        <header className="tprm-topbar">
            <div className="tprm-topbar-title">{title}</div>
            <div className="tprm-topbar-spacer" />

            <label className="tprm-topbar-label" htmlFor="tprm-topbar-client">Client</label>
            <select
                id="tprm-topbar-client"
                className="tprm-topbar-select"
                value={tenant ? tenant.tenant_id : ""}
                onChange={(e) => setTenant(e.target.value)}
                disabled={tenants.length === 0}
            >
                {tenants.length === 0
                    ? <option value="">No client assigned</option>
                    : tenants.map(t => (
                        <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>
                    ))}
            </select>

            <button className="tprm-btn sm" onClick={() => navigate("/My_Account")}>
                My Account
            </button>
            <button className="tprm-btn sm" onClick={signOut}>
                Sign out
            </button>
        </header>
    );
}

export default TPRMTopBar;
