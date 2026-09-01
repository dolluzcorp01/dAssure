// The sidebar: a flat list of every page, text only.
//
// NAV_ITEMS is the single source of truth for what exists and who may see it.
// The top bar imports it too, so the page title and the menu can never
// disagree about what a route is called.
//
// The client selector, My Account and Sign out all live in the top bar. This
// rail carries navigation and nothing else.

import React, { useMemo } from "react";
import { NavLink } from "react-router-dom";
import { useAccess } from "./utils/AccessContext";
import logo_eagle from "./assets/img/logo_eagle.png";
import "./left_navbar.css";

// [label, route, permission]  -  a null permission means everyone.
export const NAV_ITEMS = [
    ["Dashboard", "/Dashboard", null],
    ["Clients", "/Clients", null],
    ["Vendor Population", "/Vendor_Population", "vendor.manage"],
    ["Assessments", "/Assessments", null],
    ["Findings", "/Findings", null],
    ["Reports", "/Reports", "report.generate"],
    ["Question Bank", "/Question_Bank", null],
    ["Methodology", "/Methodology", "methodology.edit"],
    ["Users and Roles", "/Users_And_Roles", "user.grant"],
    ["Banners", "/Banners", "banner.manage"],
    ["Audit Trail", "/Audit_Trail", "audit.read"],
];

function LeftNavbar() {
    const { user, tenant, hasPerm } = useAccess();

    // Menu visibility follows the permissions on the SELECTED client. Switch
    // client and the menu can legitimately change.
    const nav = useMemo(
        () => NAV_ITEMS.filter(([, , perm]) => !perm || hasPerm(perm)),
        [hasPerm]);

    return (
        <aside className="tprm-navbar">
            <div className="tprm-nav-brand">
                <img src={logo_eagle} alt="Dolluz Corp" className="tprm-nav-logo" />
                <div className="tprm-nav-brandtext">
                    <div className="tprm-nav-brandname">DOLLUZ CORP</div>
                    <div className="tprm-nav-brandsub">TPRM TOOLKIT</div>
                </div>
            </div>

            <nav className="tprm-nav-scroll">
                {nav.map(([label, to]) => (
                    <NavLink
                        key={to}
                        to={to}
                        className={({ isActive }) => "tprm-nav-row" + (isActive ? " active" : "")}
                    >
                        {label}
                    </NavLink>
                ))}
            </nav>

            <div className="tprm-nav-foot">
                <div className="tprm-nav-footlabel">Signed in as</div>
                <div className="tprm-nav-username">{user ? user.emp_name : ""}</div>
                {/* The readable name, not the code. 'Practice Head' tells you
                    what you can do here; 'PH' only tells you if you already know. */}
                <div className="tprm-nav-userrole">
                    {tenant && tenant.roleNames && tenant.roleNames.length
                        ? tenant.roleNames.join(", ")
                        : tenant && tenant.roles && tenant.roles.length
                            ? tenant.roles.join(", ")
                            : "No engagement"}
                </div>
            </div>
        </aside>
    );
}

export default LeftNavbar;
