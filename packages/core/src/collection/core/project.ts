// Field projection over records — the ONE implementation behind both the
// server store layer (`server/storePage.ts#projectItemFields`) and the
// remote-view page builder (`remote-view#projectItems`). Isomorphic and
// dependency-free so either side can import it; extracted to kill the
// jscpd duplicate the two copies were.

/** Keep only `fields` (+ `primaryKey`, always) on each record. No `fields`
 *  ⇒ records pass through untouched. */
export function projectRecordFields<T extends Record<string, unknown>>(items: T[], fields: readonly string[] | undefined, primaryKey: string): T[] {
  if (!fields) return items;
  const keep = new Set([primaryKey, ...fields]);
  return items.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => keep.has(key))) as T);
}
