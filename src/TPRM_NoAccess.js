// What a person sees when their role does not reach a page.
//
// It used to be a redirect to /login. That is the worst possible answer: the
// person is signed in, nothing has expired, and being dropped on a sign-in
// screen reads as "the system has logged me out" - so they sign in again, land
// back where they were, and try the same link. Nobody learns anything, and the
// support call is about a login problem that does not exist.
//
// So: stay signed in, say plainly what happened, name the role that decided
// it, and offer the way onward. The permission key is shown small, because the
// person who eventually asks "why can't I?" is asking someone who will want to
// know exactly which key to grant.

import React from "react";
import { useNavigate } from "react-router-dom";
import { useAccess } from "./utils/AccessContext";
import { firstAllowedRoute, navLabel, NAV_ITEMS } from "./left_navbar";
import { ROLE_INFO, roleCode } from "./utils/tprmRoles";

function TPRMNoAccess({ perm }) {
    const { tenant, hasPerm, setupMode } = useAccess();
    const navigate = useNavigate();

    const code = roleCode(tenant);
    const role = (ROLE_INFO[code] || {}).name;
    const to = firstAllowedRoute(hasPerm, code, setupMode);
    const label = navLabel(NAV_ITEMS.find(i => i.to === to) || { label: "My Account" }, code);

    return (
        <div className="tprm-page">
            <div className="tprm-card" style={{ maxWidth: 620, margin: "40px auto", textAlign: "center" }}>
                <div className="tprm-lab" style={{ marginBottom: 10 }}>NOT AVAILABLE TO YOUR ROLE</div>

                <div style={{ fontSize: 19, fontWeight: 700, color: "var(--tprm-body)" }}>
                    This page is not part of your role
                </div>

                <div style={{ fontSize: 14, color: "var(--tprm-muted)", marginTop: 10, lineHeight: 1.55 }}>
                    {role && tenant
                        ? <>You are <b>{role}</b> on {tenant.tenant_name}, and that role does not
                            include this screen.</>
                        : <>Your role does not include this screen.</>}
                    {" "}You are still signed in - nothing has gone wrong.
                </div>

                <div style={{ fontSize: 13, color: "var(--tprm-muted)", marginTop: 14 }}>
                    If you need it, ask a Practice Head or Engagement Manager to grant it on
                    Users and Roles.
                </div>

                {perm && (
                    <div className="mono" style={{ fontSize: 11, color: "var(--tprm-faint)", marginTop: 8 }}>
                        requires {perm}
                    </div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22 }}>
                    <button className="tprm-btn" onClick={() => navigate(-1)}>Go back</button>
                    <button className="tprm-btn navy" onClick={() => navigate(to, { replace: true })}>
                        Go to {label}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default TPRMNoAccess;
