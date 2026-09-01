// The six engagement roles, as the UI needs to talk about them.
//
// The server is the authority on what a role may DO - every request is checked
// against the permission matrix. This file only holds what a role is CALLED and
// what colour it is drawn in, so the sidebar, the dashboard and the user list
// cannot describe the same role three different ways.
//
// Codes and names track tprm_role in db/migrations/005_seed.sql; colours track
// ROLES in Dolluz_TPRM_UI_Reference.jsx.

export const ROLE_INFO = {
    PH: { name: "Practice Head", color: "var(--tprm-ink)" },
    EM: { name: "Engagement Manager", color: "var(--tprm-purple)" },
    LA: { name: "Lead Assessor", color: "var(--tprm-blue)" },
    AS: { name: "Assessor", color: "var(--tprm-green)" },
    IA: { name: "Instrument Author", color: "var(--tprm-amber)" },
    CV: { name: "Client Viewer", color: "var(--tprm-faint)" },
};

/** The role code a person holds on the selected client, or null. */
export function roleCode(tenant) {
    return tenant && tenant.roles && tenant.roles.length ? tenant.roles[0] : null;
}

/** Ink is invisible on the navy rail, so the top role is drawn in gold there. */
export function roleColorOnDark(code) {
    const info = ROLE_INFO[code];
    if (!info) return "var(--tprm-gold)";
    return info.color === "var(--tprm-ink)" ? "var(--tprm-gold)" : info.color;
}
