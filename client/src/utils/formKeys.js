import { useEffect, useRef } from "react";

// Keyboard flow for long, multi-line entry forms (purchases): Enter moves to
// the next field instead of saving a half-filled form; Ctrl/Cmd + Enter saves.
// Use as the <form>'s onKeyDown. Buttons, links and text areas keep their
// normal Enter behaviour, and a dropdown that handles Enter itself (e.g. the
// product picker's suggestion list) stops it before it gets here.
export function enterMovesToNextField(e) {
  if (e.key !== "Enter" || e.defaultPrevented || e.nativeEvent?.isComposing) return;
  const el = e.target;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "A" || el.type === "submit" || el.type === "file") return;
  if (tag !== "INPUT" && tag !== "SELECT") return;
  e.preventDefault();
  const form = e.currentTarget;
  if (e.ctrlKey || e.metaKey) {
    form.requestSubmit();
    return;
  }
  const fields = [...form.querySelectorAll("input, select, textarea")].filter(
    (f) => !f.disabled && f.type !== "hidden" && f.type !== "file" && f.offsetParent !== null && f.tabIndex !== -1
  );
  const next = fields[fields.indexOf(el) + 1];
  if (next) {
    next.focus();
    // Select what's there, so a pre-filled value can be typed over.
    try {
      if (next.tagName === "INPUT") next.select();
    } catch {
      /* not selectable (e.g. a date field) */
    }
  }
}

// After "+ Add Line", put the cursor in the new line's first field. Attach the
// returned ref to the element that holds the lines (one child per line).
export function useFocusNewLine(lineCount) {
  const ref = useRef(null);
  const prev = useRef(lineCount);
  useEffect(() => {
    // One line more than before (not the form's lines arriving on load).
    if (prev.current > 0 && lineCount === prev.current + 1) {
      const last = ref.current?.lastElementChild;
      const field = last?.querySelector("input:not([type=hidden]):not([type=file]):not(:disabled), select:not(:disabled)");
      field?.focus();
    }
    prev.current = lineCount;
  }, [lineCount]);
  return ref;
}
