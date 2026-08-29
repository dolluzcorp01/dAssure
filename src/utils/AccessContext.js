// Permission context for dTprm.
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
import { useNavigate } from "react-router-dom";
import { apiFetch } from "./api";

const AccessContext = createContext({
    user: null,
    tenants: [],
    tenant: null,
    permissions: {},
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
                setUser(null); setTenants([]); setPermissions({});
                return;
            }
            const data = await res.json();
            setUser(data.user);
            setTenants(data.tenants || []);
            setPermissions(data.permissions || {});

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
            setUser(null); setTenants([]); setPermissions({});
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

    const hasPerm = useCallback((key) => permSet.has(key), [permSet]);

    const value = useMemo(() => ({
        user, tenants, tenant, tenantId, permissions, ready, hasPerm, setTenant, refetch,
    }), [user, tenants, tenant, tenantId, permissions, ready, hasPerm, setTenant, refetch]);

    return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export const useAccess = () => useContext(AccessContext);

/**
 * Route guard. Wrap any route that needs a signed-in user, and optionally a
 * permission on the currently selected client.
 *
 *   <Route path="/Methodology" element={
 *     <ProtectedRoute perm="methodology.edit"><Methodology /></ProtectedRoute>
 *   } />
 */
export function ProtectedRoute({ perm, fallback = "/login", children }) {
    const { ready, user, hasPerm } = useAccess();
    const navigate = useNavigate();

    useEffect(() => {
        if (!ready) return;
        if (!user) { navigate("/login", { replace: true }); return; }
        if (perm && !hasPerm(perm)) navigate(fallback, { replace: true });
    }, [ready, user, perm, hasPerm, fallback, navigate]);

    if (!ready) return null;
    if (!user) return null;
    if (perm && !hasPerm(perm)) return null;
    return children;
}
