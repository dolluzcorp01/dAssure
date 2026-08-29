// The sidebar. NAV_CONFIG is the single source of truth for what exists;
// the `perm` on each leaf decides whether the current person sees it on the
// currently selected client.
//
// Colours follow the same rule as dAdmin: one hue per group, each row a
// distinct tint of it, all inside a lightness band that stays legible on the
// navy rail.

import React, { useState, useMemo, useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
    FaChartPie, FaBuilding, FaSitemap, FaClipboardCheck, FaExclamationTriangle,
    FaFileContract, FaBookOpen, FaSlidersH, FaUserShield, FaHistory,
    FaSignOutAlt, FaAngleLeft, FaAngleRight, FaChevronDown, FaChevronUp,
} from "react-icons/fa";
import { useAccess } from "./utils/AccessContext";
import { apiFetch } from "./utils/api";
import logo_eagle from "./assets/img/logo_eagle.png";
import "./left_navbar.css";

const NAV_CONFIG = [
    { label: "Dashboard", icon: FaChartPie, color: "#51acd6", to: "/Dashboard" },
    {
        id: "delivery", label: "Delivery", icon: FaSitemap, color: "#e2823f",
        children: [
            { label: "Clients", icon: FaBuilding, color: "#eb986f", to: "/Clients" },
            { label: "Vendor Population", icon: FaSitemap, color: "#f3ad81", to: "/Vendor_Population", perm: "vendor.manage" },
            { label: "Assessments", icon: FaClipboardCheck, color: "#e8aa68", to: "/Assessments" },
            { label: "Findings", icon: FaExclamationTriangle, color: "#f1be79", to: "/Findings" },
        ],
    },
    {
        id: "output", label: "Output", icon: FaFileContract, color: "#51d69f",
        children: [
            { label: "Reports", icon: FaFileContract, color: "#60e2c8", to: "/Reports", perm: "report.generate" },
        ],
    },
    {
        id: "config", label: "Configuration", icon: FaSlidersH, color: "#7462da",
        children: [
            { label: "Question Bank", icon: FaBookOpen, color: "#8f6feb", to: "/Question_Bank" },
            { label: "Methodology", icon: FaSlidersH, color: "#ac60e2", to: "/Methodology", perm: "methodology.edit" },
            { label: "Users and Roles", icon: FaUserShield, color: "#c481f3", to: "/Users_And_Roles", perm: "user.grant" },
        ],
    },
    {
        id: "governance", label: "Governance", icon: FaHistory, color: "#d65165",
        children: [
            { label: "Audit Trail", icon: FaHistory, color: "#e26860", to: "/Audit_Trail", perm: "audit.read" },
        ],
    },
];

function LeftNavbar({ navSize, setNavSize }) {
    const { user, tenant, tenants, setTenant, hasPerm } = useAccess();
    const location = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState({ delivery: true, output: true, config: false, governance: false });

    const pathname = location.pathname.toLowerCase();

    // Open the group that contains the current page, so a deep link lands with
    // the right section already expanded.
    useEffect(() => {
        for (const item of NAV_CONFIG) {
            if (!item.children) continue;
            if (item.children.some(c => c.to && c.to.toLowerCase() === pathname)) {
                setOpen(o => ({ ...o, [item.id]: true }));
            }
        }
    }, [pathname]);

    // Menu visibility follows the permissions on the SELECTED client. Switch
    // client and the menu can legitimately change.
    const nav = useMemo(() => {
        const keep = (item) => {
            if (item.children) {
                const kids = item.children.filter(keep);
                return kids.length ? { ...item, children: kids } : null;
            }
            return !item.perm || hasPerm(item.perm) ? item : null;
        };
        return NAV_CONFIG.map(keep).filter(Boolean);
    }, [hasPerm]);

    const signOut = async () => {
        await apiFetch("/api/tprm/login/logout", { method: "POST" }).catch(() => {});
        localStorage.removeItem("dTprm_tenant");
        navigate("/login", { replace: true });
        window.location.reload();
    };

    const iconOnly = navSize === "icon-only";

    const renderLeaf = (item) => (
        <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => "tprm-nav-row" + (isActive ? " active" : "")}
            style={{ "--icon-color": item.color }}
            title={iconOnly ? item.label : undefined}
        >
            <span className="tprm-nav-icon"><item.icon /></span>
            {!iconOnly && <span className="tprm-nav-label">{item.label}</span>}
        </NavLink>
    );

    return (
        <aside className={`tprm-navbar ${navSize}`}>
            <div className="tprm-nav-brand">
                <img src={logo_eagle} alt="Dolluz Corp" className="tprm-nav-logo" />
                {!iconOnly && (
                    <div className="tprm-nav-brandtext">
                        <div className="tprm-nav-brandname">DOLLUZ CORP</div>
                        <div className="tprm-nav-brandsub">TPRM TOOLKIT</div>
                    </div>
                )}
            </div>

            {/* The client selector. Everything below it changes with it, which
                is why it sits inside the sidebar rather than in a page. */}
            {!iconOnly && (
                <div className="tprm-nav-tenant">
                    <label>Client</label>
                    <select
                        value={tenant ? tenant.tenant_id : ""}
                        onChange={(e) => setTenant(e.target.value)}
                    >
                        {tenants.length === 0 && <option value="">No client assigned</option>}
                        {tenants.map(t => (
                            <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>
                        ))}
                    </select>
                </div>
            )}

            <nav className="tprm-nav-scroll">
                {nav.map(item => {
                    if (!item.children) return renderLeaf(item);
                    const isOpen = !!open[item.id];
                    return (
                        <div key={item.id} className="tprm-nav-group">
                            <button
                                type="button"
                                className="tprm-nav-grouphead"
                                style={{ "--icon-color": item.color }}
                                onClick={() => setOpen(o => ({ ...o, [item.id]: !o[item.id] }))}
                                title={iconOnly ? item.label : undefined}
                            >
                                <span className="tprm-nav-icon"><item.icon /></span>
                                {!iconOnly && (
                                    <>
                                        <span className="tprm-nav-label">{item.label}</span>
                                        <span className="tprm-nav-chev">
                                            {isOpen ? <FaChevronUp /> : <FaChevronDown />}
                                        </span>
                                    </>
                                )}
                            </button>
                            {(isOpen || iconOnly) && (
                                <div className="tprm-nav-children">
                                    {item.children.map(renderLeaf)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            <div className="tprm-nav-foot">
                {!iconOnly && user && (
                    <div className="tprm-nav-user">
                        <div className="tprm-nav-username">{user.emp_name}</div>
                        <div className="tprm-nav-userrole">
                            {tenant && tenant.roles ? tenant.roles.join(", ") : "No engagement"}
                        </div>
                    </div>
                )}
                <div className="tprm-nav-footbtns">
                    <button
                        type="button"
                        className="tprm-nav-iconbtn"
                        onClick={() => setNavSize(iconOnly ? "full" : "icon-only")}
                        title={iconOnly ? "Expand" : "Collapse"}
                    >
                        {iconOnly ? <FaAngleRight /> : <FaAngleLeft />}
                    </button>
                    <button
                        type="button"
                        className="tprm-nav-iconbtn danger"
                        onClick={signOut}
                        title="Sign out"
                    >
                        <FaSignOutAlt />
                    </button>
                </div>
            </div>
        </aside>
    );
}

export default LeftNavbar;
