import { useEffect, useRef } from "react";

/**
 * Keeps React state in step with a browser autofill.
 *
 * A controlled input takes its value from state, and state only changes when
 * onChange fires. A browser filling in saved credentials writes straight to the
 * DOM node without firing one, so the field visibly holds a password while
 * React still believes it is empty. Anything gated on that state - a submit
 * button, a validity message - then stays disabled, with nothing on screen to
 * explain why, and the only way out is to type into a field that already looks
 * correct.
 *
 * Autofill lands at two different moments, so this listens for both:
 *
 *   - on mount, for credentials the browser filled before React hydrated
 *   - on animationstart, for credentials filled afterwards. Chrome runs a CSS
 *     animation on :-webkit-autofill, and TPRM_Access.css defines an empty
 *     keyframe purely so that animation exists for this to hear
 *
 * The first pointerdown is a third net. Every browser sets the pseudo-class,
 * not every browser fires the animation, so the moment somebody touches the
 * form we reconcile against whatever the DOM actually holds.
 *
 * @param fields array of { ref, value, set } - the input, its state, its setter
 */
export default function useAutofillSync(fields) {
    // Read through a ref so the effect can stay mounted once. The array is
    // rebuilt every render; its contents are what matter, not its identity.
    const latest = useRef(fields);
    latest.current = fields;

    useEffect(() => {
        const sync = () => {
            for (const f of latest.current) {
                const el = f.ref.current;
                if (el && el.value !== f.value) f.set(el.value);
            }
        };

        // A short settle window after mount. One frame is too early: Chrome
        // fills shortly AFTER first paint, not before it. This is bounded and
        // then done - it is a settle, not a poll.
        const timers = [0, 80, 250, 600].map(ms => setTimeout(sync, ms));

        const nodes = latest.current.map(f => f.ref.current).filter(Boolean);
        nodes.forEach(el => el.addEventListener("animationstart", sync));
        document.addEventListener("pointerdown", sync, { capture: true });

        return () => {
            timers.forEach(clearTimeout);
            nodes.forEach(el => el.removeEventListener("animationstart", sync));
            document.removeEventListener("pointerdown", sync, { capture: true });
        };
    }, []);
}
