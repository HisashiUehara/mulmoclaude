/** True for a `not found` filesystem error (ENOENT) — lets callers treat a
 *  missing file as an empty/default result instead of a thrown error. */
export function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
