// One id per entry form, sent with every attempt to save it. If the answer to
// a save is lost (slow network, Save pressed twice), the server recognises the
// repeat and returns the entry already made instead of making a second one.
export function newEntryRef() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
