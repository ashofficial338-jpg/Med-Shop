import { useEffect, useState } from "react";
import RequiredMark from "./RequiredMark";
import { listRacks } from "../api/racks";
import { NO_RACK, positionsOf, rackLetter } from "../utils/rack";

// Rack + Rack Position picker for stock-in forms. `value` is a position code
// like "A-001", NO_RACK for the always-available "No Rack" fallback, or ""
// until a choice is made. `invalid` highlights it after a save attempt without one.
export default function RackInput({ id, value, onChange, invalid, label = "Rack", required = true, className = "", labelClassName = "" }) {
  const [racks, setRacks] = useState(null);
  // A chosen position decides the rack; until one is picked, remember the
  // rack the user selected so its positions can be listed.
  const [pickedLetter, setPickedLetter] = useState("");
  const isNoRack = value === NO_RACK;
  const letter = isNoRack ? NO_RACK : value ? rackLetter(value) : pickedLetter;

  useEffect(() => {
    listRacks().then(setRacks).catch(() => setRacks([]));
  }, []);

  const rack = racks?.find((r) => r.letter === letter);
  const fieldCls = "mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm font-semibold text-text focus:outline-none disabled:opacity-50";
  const stateCls = (missing) =>
    invalid && missing ? "border-danger ring-2 ring-danger/15 focus:border-danger" : "border-border focus:border-primary";

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={id} className={labelClassName}>
            {label}
            {required && <RequiredMark />}
          </label>
          <select
            id={id}
            value={letter}
            onChange={(e) => {
              const choice = e.target.value;
              setPickedLetter(choice === NO_RACK ? "" : choice);
              onChange(choice === NO_RACK ? NO_RACK : ""); // a new rack needs its position picked again
            }}
            aria-invalid={(invalid && !letter) || undefined}
            className={`${fieldCls} ${stateCls(!letter)}`}
          >
            <option value="">{racks === null ? "Loading…" : "Select rack…"}</option>
            <option value={NO_RACK}>No Rack</option>
            {racks?.map((r) => (
              <option key={r.letter} value={r.letter}>Rack {r.letter}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-position`} className={labelClassName}>
            Rack Position
            {required && <RequiredMark />}
          </label>
          <select
            id={`${id}-position`}
            value={rack && value && !isNoRack ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={!rack}
            aria-invalid={(invalid && !value && !isNoRack) || undefined}
            className={`${fieldCls} ${stateCls(!value && Boolean(letter))}`}
          >
            <option value="">{isNoRack ? "Not needed" : rack ? "Select position…" : "Pick a rack first"}</option>
            {rack &&
              positionsOf(rack).map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
          </select>
        </div>
      </div>
      {racks?.length === 0 && (
        <p className="mt-1 text-xs text-muted">No racks set up yet - choose No Rack, or add racks from Rack Finder → Manage Racks.</p>
      )}
    </div>
  );
}
