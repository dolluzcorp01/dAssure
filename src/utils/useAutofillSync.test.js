// The bug this guards against is invisible in normal use: it only appears when
// the browser fills a saved credential, which no amount of clicking through the
// app reproduces. So the two moments autofill can land are simulated directly.

import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import useAutofillSync from "./useAutofillSync";

// React 18 wants to be told a test runner is driving it, or every act() call
// warns that it might not be one.
global.IS_REACT_ACT_ENVIRONMENT = true;

function SignIn() {
    const [email, setEmail] = useState("");
    const ref = useRef(null);
    useAutofillSync([{ ref, value: email, set: setEmail }]);
    return (
        <form>
            <input ref={ref} value={email} onChange={e => setEmail(e.target.value)} />
            <button disabled={!email}>Continue</button>
        </form>
    );
}

let container;
let root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

/** What the browser does: writes the DOM value, fires no change event. */
const autofill = (input, value) => {
    const proto = Object.getPrototypeOf(input);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
};

const render = () => act(() => { root.render(<SignIn />); });
const els = () => ({
    input: container.querySelector("input"),
    button: container.querySelector("button"),
});

test("the button is disabled while nothing has been typed", () => {
    render();
    expect(els().button.disabled).toBe(true);
});

test("an autofill that lands before hydration is picked up on mount", async () => {
    render();
    const { input } = els();
    autofill(input, "someone@dolluzcorp.com");

    // The mount sync runs over a short settle window.
    await act(async () => { await new Promise(r => setTimeout(r, 120)); });

    expect(els().button.disabled).toBe(false);
    expect(els().input.value).toBe("someone@dolluzcorp.com");
});

test("an autofill that lands later is picked up from the animation", () => {
    render();
    const { input } = els();
    autofill(input, "later@dolluzcorp.com");

    act(() => {
        input.dispatchEvent(new Event("animationstart", { bubbles: true }));
    });

    expect(els().button.disabled).toBe(false);
});

test("a browser that fires no animation is caught on the first pointerdown", () => {
    render();
    const { input } = els();
    autofill(input, "quiet@dolluzcorp.com");

    act(() => {
        document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(els().button.disabled).toBe(false);
});

test("typing still works, and the sync does not fight it", () => {
    render();
    const { input } = els();

    act(() => {
        autofill(input, "typed@dolluzcorp.com");
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(els().input.value).toBe("typed@dolluzcorp.com");
    expect(els().button.disabled).toBe(false);
});
