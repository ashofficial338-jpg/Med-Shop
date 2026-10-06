import { useEffect, useState } from "react";
import RequiredMark from "./RequiredMark";
import { listRacks } from "../api/racks";
import { positionsOf, rackLetter } from "../utils/rack";

// Rack + Rack Position picker for stock-in forms. `value` is a position code
// like "A-001" ("" until both are chosen). Only racks added under Manage
// Racks are offered. `invalid` highlights it after a save attempt without one.
export default function RackInput({ id, value, onChange, invalid, label = "Rack", required = true, className = "", labelClassName = "" }) {
  const [racks, setRacks] = useState(null);
  // A chosen position decides the rack; until one is picked, remember the
  // rack the user selected so its positions can be listed.
  const [pickedLetter, setPickedLetter] = useState("");
  const letter = value ? rackLetter(value) : pickedLetter;

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
              setPickedLetter(e.target.value);
              onChange(""); // a new rack needs its position picked again
            }}
            aria-invalid={(invalid && !letter) || undefined}
            className={`${fieldCls} ${stateCls(!letter)}`}
          >
            <option value="">{racks === null ? "Loading…" : "Select rack…"}</option>
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
            value={rack && value ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={!rack}
            aria-invalid={(invalid && !value) || undefined}
            className={`${fieldCls} ${stateCls(!value)}`}
          >
            <option value="">{rack ? "Select position…" : "Pick a rack first"}</option>
            {rack &&
              positionsOf(rack).map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
          </select>
        </div>
      </div>
      {racks?.length === 0 && (
        <p className="mt-1 text-xs text-warning">No racks yet. Add one from Rack Finder → Manage Racks.</p>
      )}
    </div>
  );
}
