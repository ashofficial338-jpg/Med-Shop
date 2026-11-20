import { useEffect } from "react";

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Adds .is-visible to every .reveal element once it scrolls into view. Pass
// the data the page renders so newly mounted elements are picked up too.
export function useReveal(deps = []) {
  useEffect(() => {
    const els = [...document.querySelectorAll(".reveal:not(.is-visible)")];
    if (!("IntersectionObserver" in window) || reduceMotion()) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// Writes scroll position (--sy, px) and pointer offset (--px/--py, -1..1) as
// CSS variables on `ref`, throttled to one update per frame, for parallax.
export function useParallax(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el || reduceMotion()) return;
    let frame = 0;
    let px = 0;
    let py = 0;
    const paint = () => {
      frame = 0;
      el.style.setProperty("--sy", `${Math.min(window.scrollY, 900)}`);
      el.style.setProperty("--px", px.toFixed(3));
      el.style.setProperty("--py", py.toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onMove = (e) => {
      px = (e.clientX / window.innerWidth) * 2 - 1;
      py = (e.clientY / window.innerHeight) * 2 - 1;
      schedule();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    paint();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("pointermove", onMove);
    };
  }, [ref]);
}
