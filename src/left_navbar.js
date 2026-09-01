// The sidebar.
//
// NAV_ITEMS is the single source of truth for what exists and who may see it.
// The top bar imports it too, so the page title and the menu can never disagree
// about what a route is called.
//
// Three places a page can live, and `where` says which:
//
//   "loose"   a sidebar row below the TPRM group, under no heading. These are
//             system wide rather than per client - the standards catalogue, who
//             holds which role, the login banners.
//   "tprm"    a sidebar row inside the TPRM group: the third party risk work
//             itself.
//   "client"  NOT a sidebar row. Reached from the client tab bar, because these
//             pages are always about one client and the client selector already
//             decides which. They stay in this list so the top bar can still
//             title them and so nothing has to duplicate their routes.
//
// The reference prototype hard codes a menu per role. The real thing derives it
// from the permission matrix instead, which is why each row carries a
// permission rather than a list of roles - hiding a menu is not access control,
// and the API checks the same permission again on every request.
//
// Two rows are genuinely role-shaped rather than permission-shaped: a Lead
// Assessor's review queue and an Instrument Author's authoring bench are their
// own work lists, not capabilities a Practice Head lacks. Those carry `roles`
// as well, and it narrows the permission rather than replacing it.
//
// The client selector, My Account and Sign out all live in the top bar. This
// rail carries navigation and nothing else.

import React, { useMemo } from "react";
import { NavLink } from "react-router-dom";
import { useAccess } from "./utils/AccessContext";
import { ROLE_INFO, roleCode, roleColorOnDark } from "./utils/tprmRoles";
import "./left_navbar.css";

// label   what the row says, and what the top bar titles the page
// to       the route
// where    "loose" | "tprm" | "client"  - see the note above
// perm     required permission; null means everyone
// anyPerm  any one of these is enough
// roles    if present, also restricted to these role codes
// labelAs  per-role rename of the same route
// setup    also shown on first run, when nobody holds a grant to derive from
export const NAV_ITEMS = [
    { label: "Standards", to: "/Standards", where: "loose", perm: "case.comment" },
    { label: "Users and Roles", to: "/Users_And_Roles", where: "loose", perm: "user.grant" },
    { label: "Banners", to: "/Banners", where: "loose", perm: "banner.manage" },

    // One landing page, named for the work the role actually opens it to do.
    {
        label: "Dashboard", to: "/Dashboard", where: "tprm", perm: "dashboard.view",
        labelAs: { AS: "My Work" }, setup: true,
    },
    { label: "Clients", to: "/Clients", where: "tprm", perm: "client.create", setup: true },
    // case.comment is the marker for "works on engagements at all", which is
    // exactly who may read the library: everyone except a client viewer.
    { label: "Question Bank", to: "/Question_Bank", where: "tprm", perm: "case.comment" },
    { label: "Methodology", to: "/Methodology", where: "tprm", perm: "methodology.edit" },
    { label: "Audit Trail", to: "/Audit_Trail", where: "tprm", perm: "audit.read" },

    // Reached from the client tab bar, not the rail.
    {
        label: "Third Parties", to: "/Third_Parties", where: "client",
        anyPerm: ["vendor.manage", "assessment.perform"],
    },
    {
        label: "Assessments", to: "/Assessments", where: "client",
        anyPerm: ["vendor.manage", "assessment.perform"],
    },
    { label: "Findings", to: "/Findings", where: "client", perm: "finding.manage" },
    { label: "Reports", to: "/Reports", where: "client", perm: "report.generate" },
];

/** Does this person see this row on the client they have selected?
 *
 *  On first run there are no grants anywhere, so there is nothing to derive a
 *  menu from and a dAdmin administrator would be left staring at an empty rail
 *  with no way to create the first client. The two rows that get them out of
 *  that are marked `setup`. */
export function navVisible(item, has, code, setupMode) {
    if (setupMode) return Boolean(item.setup);
    if (item.roles && !item.roles.includes(code)) return false;
    if (item.anyPerm) return item.anyPerm.some(has);
    return !item.perm || has(item.perm);
}

/** What the row is called for this role - the route never changes, the word does. */
export function navLabel(item, code) {
    return (item.labelAs && item.labelAs[code]) || item.label;
}

function LeftNavbar() {
    const { user, tenant, hasPerm, setupMode } = useAccess();
    const code = roleCode(tenant);

    // Menu visibility follows the permissions on the SELECTED client. Switch
    // client and the menu can legitimately change.
    const [loose, tprm] = useMemo(() => {
        const shown = NAV_ITEMS.filter(i =>
            i.where !== "client" && navVisible(i, hasPerm, code, setupMode));
        return [
            shown.filter(i => i.where === "loose"),
            shown.filter(i => i.where === "tprm"),
        ];
    }, [hasPerm, code, setupMode]);

    // Codes are stored; names are shown. 'Practice Head' tells you what you can
    // do here, 'PH' only tells you if you already know.
    const roleNames = tenant && tenant.roleNames && tenant.roleNames.length
        ? tenant.roleNames.join(", ")
        : tenant && tenant.roles && tenant.roles.length
            ? tenant.roles.map(r => (ROLE_INFO[r] ? ROLE_INFO[r].name : r)).join(", ")
            : setupMode ? "Setting up"
                : "No engagement";

    const row = item => (
        <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => "tprm-nav-row" + (isActive ? " active" : "")}
        >
            {navLabel(item, code)}
        </NavLink>
    );

    return (
        <aside className="tprm-navbar">
            <div className="tprm-nav-brand">
                <div className="tprm-nav-brandname">DOLLUZ CORP</div>
                <div className="tprm-nav-brandsub">TPRM TOOLKIT</div>
            </div>

            <nav className="tprm-nav-scroll">
                {tprm.length > 0 && (
                    <>
                        <div className="tprm-nav-section">TPRM</div>
                        {tprm.map(row)}
                    </>
                )}

                {/* Only drawn when there is something on both sides of it. A rule
                    with nothing under it is a line for its own sake. */}
                {loose.length > 0 && tprm.length > 0 && <div className="tprm-nav-rule" />}

                {loose.map(row)}
            </nav>

            <div className="tprm-nav-foot">
                <div className="tprm-nav-footlabel">Signed in as</div>
                <div className="tprm-nav-username">{user ? user.emp_name : ""}</div>
                <div className="tprm-nav-userrole" style={{ color: roleColorOnDark(code) }}>
                    {roleNames}
                </div>
            </div>
        </aside>
    );
}

export default LeftNavbar;
