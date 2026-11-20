// Branded loading state: orbiting ring around a pulsing medical cross.
export default function Loader({ label = "Loading…", className = "" }) {
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-4 py-16 ${className}`}>
      <div className="gm-loader">
        <span />
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary/80">{label}</p>
    </div>
  );
}
