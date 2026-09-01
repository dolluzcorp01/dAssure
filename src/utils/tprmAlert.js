// Thin wrapper over SweetAlert2, themed to the Dolluz Corp palette so every
// dialog in dTprm looks the same and no page has to remember the colours.

import Swal from "sweetalert2";

const GOLD = "#8A6D12";
const NAVY = "#0D1B2A";

const base = {
    confirmButtonColor: GOLD,
    cancelButtonColor: "#7A8798",
    customClass: { popup: "tprm-swal" },
    // A click on the backdrop must not dismiss a dialog. Several of these ask
    // for a typed reason that goes into the audit record, and losing it to a
    // stray click is the worst version of this interaction. Escape still
    // works - that one is deliberate.
    allowOutsideClick: false,
};

export const tprmAlert = {
    success: (title, text) =>
        Swal.fire({
            ...base, icon: "success", title, text, timer: 2200, showConfirmButton: false,
            allowOutsideClick: true,   // transient toast - nothing to lose
        }),

    error: (title, text) =>
        Swal.fire({ ...base, icon: "error", title: title || "That did not work", text }),

    info: (title, text) => Swal.fire({ ...base, icon: "info", title, text }),

    confirm: (title, text, confirmText = "Yes, continue") =>
        Swal.fire({
            ...base, icon: "warning", title, text,
            showCancelButton: true, confirmButtonText: confirmText, cancelButtonText: "Cancel",
        }).then(r => r.isConfirmed),

    /** For anything that needs a written reason. Enforces a minimum length so
     *  the record is worth reading later. */
    reason: (title, label, minLength = 10) =>
        Swal.fire({
            ...base, title, input: "textarea", inputLabel: label,
            inputAttributes: { "aria-label": label },
            showCancelButton: true, confirmButtonText: "Save",
            inputValidator: (v) =>
                (!v || v.trim().length < minLength)
                    ? `Please write at least ${minLength} characters. This becomes part of the audit record.`
                    : undefined,
        }).then(r => (r.isConfirmed ? r.value : null)),

    /** Renders a server validation error with its per-field details. */
    apiError: (err) => {
        const details = Array.isArray(err && err.details) ? err.details : [];
        if (details.length) {
            return Swal.fire({
                ...base, icon: "error",
                title: err.message || "That did not work",
                html: `<ul style="text-align:left;margin:0;padding-left:18px;color:${NAVY}">`
                    + details.map(d => `<li>${d.message || d}</li>`).join("")
                    + `</ul>`,
            });
        }
        return Swal.fire({
            ...base, icon: "error",
            title: (err && err.message) || "That did not work",
        });
    },
};

export default tprmAlert;
