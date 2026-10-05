import { useEffect, useRef, useState } from "react";

// Eases a figure from its previous value to the new one (from 0 on first
// render), so headline numbers "settle" into place. `format` turns the
// in-between number into display text. Respects reduced-motion.
export default function CountUp({ value, format = String, duration = 900 }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    if (reduce || from === target) {
      fromRef.current = target;
      setShown(target);
      return undefined;
    }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      const v = from + (target - from) * eased;
      fromRef.current = v;
      setShown(t === 1 ? target : v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return <>{format(shown)}</>;
}
