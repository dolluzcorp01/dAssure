// Dialogs for dTprm.
//
// The public surface here has not changed - success / error / info / confirm /
// reason / apiError, same arguments, same return values - so no calling page
// had to be touched. What changed is underneath: these used to be SweetAlert2,
// and are now plain React rendered by <TPRMDialogHost /> in App.js, drawn with
// the product's own tokens rather than a second library's idea of a dialog.
//
// The bridge is deliberately tiny. A page calls tprmAlert.confirm(...) from an
// ordinary async function and gets a promise back; this module pushes the
// request onto a queue and the host renders it. Nothing imports the host, and
// the host imports nothing from the pages.

let seq = 0;
let listener = null;          // the mounted host, or null before it mounts
let queue = [];               // dialogs raised before the host mounted

/** Called once by the host on mount. */
export function subscribeToDialogs(fn) {
    listener = fn;
    if (queue.length) { queue.forEach(fn); queue = []; }
    return () => { listener = null; };
}

function raise(spec) {
    return new Promise((resolve) => {
        const item = { id: ++seq, ...spec, resolve };
        if (listener) listener(item);
        else queue.push(item);      // e.g. an error during first render
    });
}

export const tprmAlert = {
    /** A transient toast. Nothing to lose, so it dismisses itself. */
    success: (title, text) => raise({ kind: "toast", tone: "success", title, text }),

    error: (title, text) =>
        raise({ kind: "alert", tone: "error", title: title || "That did not work", text }),

    info: (title, text) => raise({ kind: "alert", tone: "info", title, text }),

    /** Resolves true only when the confirming button is pressed. */
    confirm: (title, text, confirmText = "Yes, continue") =>
        raise({ kind: "confirm", tone: "warning", title, text, confirmText }),

    /** For anything that needs a written reason. Enforces a minimum length so
     *  the record is worth reading later. Resolves the text, or null. */
    reason: (title, label, minLength = 10) =>
        raise({ kind: "reason", tone: "warning", title, label, minLength }),

    /** Renders a server validation error with its per-field details. */
    apiError: (err) =>
        raise({
            kind: "alert",
            tone: "error",
            title: (err && err.message) || "That did not work",
            details: Array.isArray(err && err.details) ? err.details : [],
        }),
};

export default tprmAlert;
