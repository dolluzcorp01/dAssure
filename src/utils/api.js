export const API_BASE =
    process.env.NODE_ENV === "production"
        ? process.env.REACT_APP_API
        : "http://localhost:4009";

// dAdmin owns the global sign-in config (banners, figures, two-step). Read-only
// and unauthenticated, read cross-origin from every dApp's sign-in screen.
// Reached with a plain fetch - never apiFetch, which targets this app's own
// backend, sends its cookie and attaches a client's tenant id, none of which
// belongs on a request to another origin.
export const DADMIN_API_BASE =
    process.env.NODE_ENV === "production"
        ? process.env.REACT_APP_DADMIN_API
        : "http://localhost:4002";

// Every request carries the cookie and, where a client is selected, the
// x-tenant-id header. The server never trusts that header on its own - it
// re-checks membership on every call - but sending it means a route handler
// can scope a query without the id being in the URL.
export async function apiFetch(endpoint, options = {}) {
    const tenantId = localStorage.getItem("dTprm_tenant");
    const headers = { ...(options.headers || {}) };
    if (tenantId && !headers["x-tenant-id"]) headers["x-tenant-id"] = tenantId;
    const res = await fetch(`${API_BASE}${endpoint}`, {
        credentials: "include",
        ...options,
        headers,
    });
    if (res.status === 401) noticeRevocation(res);
    return res;
}

/* An administrator ending this session in dAdmin arrives as a 401 on whatever
   call happened next, not only on /me. Announce it, so AccessContext drops the
   session and ProtectedRoute bounces to /login carrying the reason - the same
   path every other refusal takes. Read from a clone, so the caller still gets
   its own body. */
function noticeRevocation(res) {
    res.clone().json()
        .then((body) => {
            if (body && body.error === "SESSION_REVOKED") {
                window.dispatchEvent(new CustomEvent("tprm:session-revoked",
                    { detail: body.message }));
            }
        })
        .catch(() => { /* not JSON - not ours to interpret */ });
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

/** Fetch a file from an authenticated endpoint and hand back the bytes plus the
 *  name the server gave it. Separate from apiDownload because a file is not
 *  always something to save: a PDF can be shown on screen first, and the same
 *  blob then saved without asking the server for it twice. The caller owns the
 *  blob, so the caller decides when it is finished with. */
export async function apiBlob(endpoint, fallbackName = "download") {
    const res = await apiFetch(endpoint);
    if (!res.ok) {
        let data = null;
        try { data = await res.json(); } catch { /* not json */ }
        const err = new Error((data && (data.message || data.error)) || `Download failed (${res.status})`);
        err.status = res.status;
        err.code = data && data.error;
        throw err;
    }
    const disp = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^"]+)"?/.exec(disp);
    return { blob: await res.blob(), filename: match ? match[1] : fallbackName };
}

/** Save a blob under a filename, through a link the browser then discards. */
export function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Trigger a browser download from an authenticated endpoint. */
export async function apiDownload(endpoint, fallbackName = "download") {
    const { blob, filename } = await apiBlob(endpoint, fallbackName);
    saveBlob(blob, filename);
}
