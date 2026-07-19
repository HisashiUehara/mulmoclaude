// Pure paging/projection primitives shared by the store implementations.
// Split out of store.ts so a backend module (e.g. sqliteStore.ts, which
// store.ts imports to register its factory) can use them without a
// runtime import cycle. store.ts re-exports everything here, so the
// public `@mulmoclaude/core/collection/server` surface is unchanged.

import type { CollectionItem } from "../core/schema";

/** Options for `page`. STORED fields only — computed fields (`derived` /
 *  `toggle` / `embed` / rollups) never reach the store; project them at the
 *  engine level after enrichment. */
export interface ListOptions {
  /** 0-based offset into the store's stable order (see the contract). */
  offset?: number;
  /** Max records returned. Absent = all remaining (subject to store caps). */
  limit?: number;
  /** Keep only these fields per record (the primary key is always kept). */
  fields?: readonly string[];
}

export interface ListPage {
  items: CollectionItem[];
  /** Records in the collection before offset/limit — a lower bound when
   *  `truncated` (the store capped its scan, e.g. `MAX_CSV_ROWS`). */
  total: number;
  truncated: boolean;
}

export interface WriteOptions {
  /** Create semantics: fail with `kind: "conflict"` when the record
   *  already exists (an O_EXCL open in the file store — race-safe). */
  refuseOverwrite?: boolean;
}

/** Project `fields` (+ the primary key, always) out of each record. No
 *  `fields` ⇒ records pass through untouched. Pure, exported for tests. */
export function projectItemFields(items: CollectionItem[], fields: readonly string[] | undefined, primaryKey: string): CollectionItem[] {
  if (!fields) return items;
  const keep = new Set([primaryKey, ...fields]);
  return items.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => keep.has(key))));
}

/** Slice + project an already-ordered full read into a `ListPage` — the
 *  shared emulation for stores without native paging. Pure, exported for
 *  tests. `limit: 0` is a valid "count only" page. */
export function pageFromFullRead(items: CollectionItem[], opts: ListOptions, primaryKey: string, truncated: boolean): ListPage {
  const offset = Math.max(0, opts.offset ?? 0);
  const end = opts.limit === undefined ? undefined : offset + Math.max(0, opts.limit);
  return { items: projectItemFields(items.slice(offset, end), opts.fields, primaryKey), total: items.length, truncated };
}
