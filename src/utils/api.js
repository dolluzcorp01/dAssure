export const API_BASE =
    process.env.NODE_ENV === "production"
        ? process.env.REACT_APP_API
        : "http://localhost:4009";

// Every request carries the cookie and, where a client is selected, the
// x-tenant-id header. The server never trusts that header on its own - it
// re-checks membership on every call - but sending it means a route handler
// can scope a query without the id being in the URL.
export async function apiFetch(endpoint, options = {}) {
    const tenantId = localStorage.getItem("dTprm_tenant");
    const headers = { ...(options.headers || {}) };
    if (tenantId && !headers["x-tenant-id"]) headers["x-tenant-id"] = tenantId;
    return fetch(`${API_BASE}${endpoint}`, {
        credentials: "include",
        ...options,
        headers,
    });
}

export async function apiJson(endpoint, options = {}) {
    const res = await apiFetch(endpoint, options);
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
        const err = new Error((data && (data.message || data.error)) || `Request failed (${res.status})`);
        err.status = res.status;
        err.code = data && data.error;
        err.details = data && data.details;
        throw err;
    }
    return data;
}

export async function apiPost(endpoint, body, options = {}) {
    return apiJson(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
        ...options,
    });
}

export async function apiPut(endpoint, body) {
    return apiJson(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
}

export async function apiDelete(endpoint) {
    return apiJson(endpoint, { method: "DELETE" });
}

/** Upload a file to a multipart endpoint. */
export async function apiUpload(endpoint, file, fields = {}) {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(fields).forEach(([k, v]) => { if (v != null) fd.append(k, v); });
    return apiJson(endpoint, { method: "POST", body: fd });
}

/** Trigger a browser download from an authenticated endpoint. */
export async function apiDownload(endpoint, fallbackName = "download") {
    const res = await apiFetch(endpoint);
    if (!res.ok) {
        let data = null;
        try { data = await res.json(); } catch { /* not json */ }
        const err = new Error((data && (data.message || data.error)) || `Download failed (${res.status})`);
        err.code = data && data.error;
        throw err;
    }
    const disp = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^"]+)"?/.exec(disp);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = match ? match[1] : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
