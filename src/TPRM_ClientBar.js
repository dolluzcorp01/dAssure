// The client bar: who this screen is about, and the other screens about them.
//
// Third parties, assessments, findings and reports were rail items, which said
// they were peers of Clients and Methodology. They are not - every one of them
// is a view of one client, and which client was decided somewhere else entirely,
// by the selector in the top bar. Putting them on a bar under the client's own
// name says that: the engagement is the subject, these are its pages.
//
// The bar is also the answer to "whose numbers am I looking at". A findings
// table with no client named above it is a table you have to take on trust.

import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiJson } from "./utils/api";
import { useAccess } from "./utils/AccessContext";
import { NAV_ITEMS, navVisible } from "./left_navbar";
import { roleCode } from "./utils/tprmRoles";
import "./TPRM_ClientBar.css";

// Overview and the pipeline are not rail items in their own right, so they are
// named here. Everything else is read from NAV_ITEMS, which keeps one list in
// charge of what a page is called and who may open it.
// Overview and the pipeline are not rail items in their own right, so they are
// named here. Everything else is read from NAV_ITEMS, which keeps one list in
// charge of what a page is called and who may open it.
function tabsFor(hasPerm, code, tenantId) {
    const out = [];
    const push = (to, label, ok) => { if (ok) out.push({ to, label }); };

    push(`/Clients/${tenantId}`, "Overview", true);
    for (const item of NAV_ITEMS.filter(i => i.where === "client")) {
        push(item.to, item.label, navVisible(item, hasPerm, code, false));
        if (item.to === "/Third_Parties") {
            push("/Vendor_Population", "Vendor Population", hasPerm("vendor.manage"));
        }
    }
    return out;
}

function TPRMClientBar() {
    const { tenant, tenantId, hasPerm } = useAccess();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [ctx, setCtx] = useState(null);
    const code = roleCode(tenant);

    useEffect(() => {
        if (!tenantId) { setCtx(null); return; }
        apiJson(`/api/tprm/clients/${tenantId}/context`).then(setCtx).catch(() => setCtx(null));
    }, [tenantId]);

    const tabs = tabsFor(hasPerm, code, tenantId);
    const p = pathname.toLowerCase();
    // Longest match wins, so /Assessments/12 keeps the Assessments tab lit.
    const active = tabs
        .filter(t => p === t.to.toLowerCase() || p.startsWith(t.to.toLowerCase() + "/"))
        .sort((a, b) => b.to.length - a.to.length)[0];

    // Mounted once for the whole app, so it decides for itself where it belongs:
    // on a page about one client, when a client is actually selected, and only
    // when there is somewhere to go. A Client Viewer can reach one of these
    // pages and no other - a bar with a single tab is not navigation, it is a
    // strip of chrome pretending to be some.
    if (!tenantId || !active || tabs.length < 2) return null;

    // The name is known from the selector before the context call returns, so
    // the bar does not appear empty and then fill in.
    const name = (ctx && ctx.name) || (tenant && tenant.tenant_name) || "";
    const badge = (ctx && ctx.code) || (tenant && tenant.tenant_code) || "";
    const facts = ctx
        ? [ctx.sectorName, (ctx.regions || [])[0], ctx.scaleBand].filter(Boolean)
        : [];

    return (
        <div className="tprm-cbar">
            <div className="tprm-cbar-top">
                {/* The code, not the name. It is what appears in every document
                    reference we issue, so it is the client's actual handle. */}
                <div className="tprm-cbar-badge">{badge}</div>
                <div className="tprm-cbar-who">
                    <div className="tprm-cbar-name">{name}</div>
                    {facts.length > 0 && (
                        <div className="tprm-cbar-facts">{facts.join("  |  ")}</div>
                    )}
                </div>
                <div className="tprm-cbar-spacer" />
                {ctx && ctx.overlay && ctx.overlay.length > 0 && (
                    <div className="tprm-cbar-overlay">
                        <div className="tprm-cbar-overlaylab">Regulatory overlay</div>
                        <div className="tprm-cbar-chips">
                            {ctx.overlay.slice(0, 3).map(o => (
                                <span className="tprm-chip gold" key={o}>{o}</span>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="tprm-cbar-tabs" role="tablist">
                {tabs.map(t => (
                    <button
                        key={t.to}
                        type="button"
                        role="tab"
                        aria-selected={active && active.to === t.to}
                        className={"tprm-cbar-tab" + (active && active.to === t.to ? " on" : "")}
                        onClick={() => navigate(t.to)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

export default TPRMClientBar;
