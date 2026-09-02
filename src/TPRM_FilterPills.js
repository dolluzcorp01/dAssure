// Status filters, the way dAdmin filters a payslip run.
//
// A register is read one state at a time - "what still needs deciding" is a
// different job from "what did I descope" - and a count on the pill answers
// the question before you have clicked it.
//
// A state with nothing in it is left showing zero rather than hidden, because
// a disappearing filter makes the row of them jump about as work progresses,
// and you lose the position you had learned.

import React from "react";

function FilterPills({ options, value, onChange }) {
    return (
        <div className="tprm-pills">
            {options.map(o => (
                <button
                    key={o.key}
                    type="button"
                    className={"tprm-pill" + (value === o.key ? " on" : "")}
                    onClick={() => onChange(o.key)}
                    aria-pressed={value === o.key}
                >
                    {o.label}
                    <span className="tprm-pill-n">{o.n}</span>
                </button>
            ))}
        </div>
    );
}

export default FilterPills;
