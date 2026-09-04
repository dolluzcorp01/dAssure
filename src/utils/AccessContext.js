// Permission context for dAssure.
//
// Same shape as dAdmin's AccessContext, but the matrix is per CLIENT rather
// than per role. A person can be Lead Assessor on one engagement and plain
// Assessor on another, so hasPerm() is always answered against the client
// currently selected in the top bar.
//
// Hiding a menu is not access control. Every route re-checks server side.

import React, {
    createContext, useContext, useEffect, useState, useCallback, useMemo,
} from "react";
import { apiFetch } from "./api";

const AccessContext = createContext({
    user: null,
    tenants: [],
    tenant: null,
    permissions: {},
    setupMode: false,
    accessError: null,
    ready: false,
    hasPerm: () => false,
    setTenant: () => {},
    refetch: async () => {},
});

const STORAGE_KEY = "dTprm_tenant";

export function AccessProvider({ children }) {
    const [user, setUser] = useState(null);
    const [tenants, setTenants] = useState([]);
    const [permissions, setPermissions] = useState({});
    // First run: no client exists yet and this person may create the first one.
    const [setupMode, setSetupMode] = useState(false);
    // Why the session is unusable, when it is. 403 NO_ENGAGEMENT is not the
    // same as being signed out, and the sign-in screen should say which.
    const [accessError, setAccessError] = useState(null);
    const [tenantId, setTenantId] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? Number(saved) : null;
    });
    const [ready, setReady] = useState(false);

    const refetch = useCallback(async () => {
        setReady(false);
        try {
            const res = await apiFetch("/api/tprm/login/me");
            if (!res.ok) {
                // 403 means the account is real but holds no engagement. Treat it
                // like 401 for routing, but keep the reason so the sign-in screen
                // can explain rather than silently bouncing.
                let reason = null;
                if (res.status === 403) {
                    const body = await res.json().catch(() => null);
                    reason = (body && body.message) || 'You have no engagement in dAssure.';
                }
                setUser(null); setTenants([]); setPermissions({}); setSetupMode(false);
                setAccessError(reason);
                return;
            }
            const data = await res.json();
            setUser(data.user);
            setTenants(data.tenants || []);
            setPermissions(data.permissions || {});
            setSetupMode(!!data.setupMode);
            setAccessError(null);

            // Keep the saved client only if it is still one the user can see.
            setTenantId(prev => {
                const ok = (data.tenants || []).some(t => Number(t.tenant_id) === Number(prev));
                const next = ok ? prev : (data.tenants && data.tenants[0]
                    ? Number(data.tenants[0].tenant_id) : null);
                if (next) localStorage.setItem(STORAGE_KEY, String(next));
                else localStorage.removeItem(STORAGE_KEY);
                return next;
            });
        } catch {
            setUser(null); setTenants([]); setPermissions({}); setSetupMode(false);
            setAccessError(null);
        } finally {
            setReady(true);
        }
    }, []);

    useEffect(() => { refetch(); }, [refetch]);

    const setTenant = useCallback((id) => {
        setTenantId(Number(id));
        localStorage.setItem(STORAGE_KEY, String(id));
    }, []);

    const tenant = useMemo(
        () => tenants.find(t => Number(t.tenant_id) === Number(tenantId)) || null,
        [tenants, tenantId]);

    const permSet = useMemo(() => {
        const list = (tenantId && permissions[tenantId]) || [];
        return new Set(list);
    }, [permissions, tenantId]);

    // On first run there is no client to hold a permission on, so the two
    // abilities that open the system up are answered from setupMode instead.
    // The server applies exactly the same rule - this only decides what the
    // menu shows.
    const hasPerm = useCallback(
        (key) => permSet.has(key)
            || (setupMode && (key === "client.create" || key === "user.grant")),
        [permSet, setupMode]);

    const value = useMemo(() => ({
        user, tenants, tenant, tenantId, permissions, setupMode, accessError, ready,
        hasPerm, setTenant, refetch,
    }), [user, tenants, tenant, tenantId, permissions, setupMode, accessError, ready,
        hasPerm, setTenant, refetch]);

    return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export const useAccess = () => useContext(AccessContext);

// ProtectedRoute used to live here. It now sits in ProtectedRoute.js, where it
// can render a real refusal page instead of redirecting a signed-in person to
// the sign-in screen - which needs the navigation table, which needs this
// context, so it could not import it from here.
