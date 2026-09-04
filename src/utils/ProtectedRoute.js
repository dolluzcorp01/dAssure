// The route guard, and where an unknown URL lands.
//
// Split out of AccessContext so that the refusal screen can be a real page
// with the navigation table behind it, without the context importing the
// navigation that imports the context.
//
// Two rules here, and the difference between them matters:
//
//   not signed in  -> go to /login, carrying the reason
//   signed in, but the role does not reach this page -> STAY, and say so
//
// The second used to do the first, which told a signed-in person that they
// were signed out. Route guards are also only a courtesy: every one of these
// pages calls an API that checks the same permission again, so this decides
// what somebody is shown, never what they are allowed.

import React, { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAccess } from "./AccessContext";
import { firstAllowedRoute } from "../left_navbar";
import { roleCode } from "./tprmRoles";
import TPRMNoAccess from "../TPRM_NoAccess";

export function ProtectedRoute({ perm, anyPerm, children }) {
    const { ready, user, hasPerm, accessError } = useAccess();
    const navigate = useNavigate();

    useEffect(() => {
        if (!ready || user) return;
        // Carry the reason across so the sign-in screen can show it instead of
        // looking like an ordinary signed-out state.
        navigate("/login", {
            replace: true,
            state: accessError ? { message: accessError } : undefined,
        });
    }, [ready, user, accessError, navigate]);

    if (!ready) return null;
    if (!user) return null;

    const allowed = anyPerm
        ? anyPerm.some(hasPerm)
        : (!perm || hasPerm(perm));

    if (!allowed) return <TPRMNoAccess perm={perm || (anyPerm || []).join(" or ")} />;
    return children;
}

/** Where "/" and any unknown URL go: the first page this role can open. */
export function TPRMHome() {
    const { ready, user, tenant, hasPerm, setupMode } = useAccess();
    if (!ready) return null;
    if (!user) return <Navigate to="/login" replace />;
    return <Navigate to={firstAllowedRoute(hasPerm, roleCode(tenant), setupMode)} replace />;
}

export default ProtectedRoute;
