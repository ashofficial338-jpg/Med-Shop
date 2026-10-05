// App-wide micro-interactions, wired once at startup with delegated listeners
// so no component has to opt in:
//  - cards track the cursor (--mx/--my) for the spotlight sheen in index.css
//  - primary/accent buttons get a soft ripple from the click point
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function trackSpotlight(e) {
  const card = e.target.closest?.(".card");
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
}

function ripple(e) {
  if (reduceMotion()) return;
  const btn = e.target.closest?.("button.bg-primary.text-white, button.bg-accent.text-white, a.bg-primary.text-white, a.bg-accent.text-white");
  if (!btn || btn.disabled) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const dot = document.createElement("span");
  dot.className = "fx-ripple";
  dot.style.width = dot.style.height = `${size}px`;
  dot.style.left = `${e.clientX - r.left - size / 2}px`;
  dot.style.top = `${e.clientY - r.top - size / 2}px`;
  btn.appendChild(dot);
  dot.addEventListener("animationend", () => dot.remove(), { once: true });
}

export function installFx() {
  if (typeof window === "undefined" || window.__fxInstalled) return;
  window.__fxInstalled = true;
  document.addEventListener("pointermove", trackSpotlight, { passive: true });
  document.addEventListener("pointerdown", ripple, { passive: true });
}
