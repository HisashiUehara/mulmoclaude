// Canonical error helpers for the whole monorepo. Host (`server/`, `src/`)
// re-exports these rather than keeping its own copy — before #2217 the same
// function existed 14 times across 4 behaviours, and the two that mattered
// disagreed on gRPC-shaped errors: `{ code, details, metadata }` surfaced as
// "quota exceeded" through the host copy and as "[object Object]" through the
// core ones. Browser-safe: pure string work, no node imports.

// Non-Error objects with a `details` (gRPC convention) or `message` string
// field have that field surfaced — without this they stringify to
// `[object Object]`.
//
// `fallback` covers the route-handler idiom where a throw of a plain non-Error
// value should surface as a descriptive message ("rebuild failed") rather than
// `String(err)` noise. Pass one at error-response boundaries; omit it for
// logging contexts where `String(err)` is fine.
export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  if (err !== null && typeof err === "object") {
    const obj = err as { details?: unknown; message?: unknown };
    if (typeof obj.details === "string" && obj.details) return obj.details;
    if (typeof obj.message === "string" && obj.message) return obj.message;
  }
  if (fallback !== undefined) return fallback;
  return String(err);
}

// Coerce an unknown caught value into an Error, preserving the original if it
// already was one. Use in error boundaries / Promise rejections / event-handler
// onerror callbacks where the downstream API wants an Error object.
//
// `fallback` is the message used when coercing a non-Error value — pass a
// descriptive string for cases where `String(err)` would just produce noise
// (e.g. `<img>.onerror` hands you an Event, not the underlying load failure).
export function toError(err: unknown, fallback?: string): Error {
  if (err instanceof Error) return err;
  return new Error(fallback ?? errorMessage(err));
}
