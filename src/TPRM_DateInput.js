// A date field that opens its calendar wherever you click it.
//
// A native <input type="date"> only opens the picker from the small icon at
// its right edge. Everywhere else in the field is a set of typeable segments,
// so clicking the middle of what looks like a button does nothing - and the
// icon is a target about six pixels wide.
//
// showPicker() is what fixes it, and it has two rules worth knowing: it throws
// unless it is called during a real user gesture, and it does not exist in
// older browsers. Both are handled by trying and moving on - a failure just
// leaves the native behaviour, which is what would have happened anyway.
//
// Deliberately bound to click rather than focus. Opening the calendar when
// someone tabs into the field takes the keyboard away from a person who was
// about to type the date, which is the faster way to enter one.

import React, { useRef } from "react";

function TPRMDateInput({ className, onClick, inputRef, ...rest }) {
    const own = useRef(null);
    const ref = inputRef || own;

    const open = (e) => {
        if (onClick) onClick(e);
        const el = ref.current;
        if (!el || el.disabled || el.readOnly) return;
        try { el.showPicker(); } catch (_) { /* older browser, or no gesture */ }
    };

    return (
        <input
            {...rest}
            ref={ref}
            type="date"
            className={"tprm-input tprm-dateinput" + (className ? " " + className : "")}
            onClick={open}
        />
    );
}

export default TPRMDateInput;
