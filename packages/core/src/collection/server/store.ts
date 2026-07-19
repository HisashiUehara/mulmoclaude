// Storage abstraction over a collection's records — the one seam where
// "where do the rows come from" is decided. Two implementations:
//
//   - file store: the classic `<dataDir>/<itemId>.json` records (io.ts),
//     writable through the governed write paths;
//   - CSV store (csvStore.ts): the rows of an external `dataSource` file,
//     queried through DuckDB — READ-ONLY by definition.
//
// Callers that only need to read records go through `storeFor(...)`;
// write paths keep calling `writeItem`/`deleteItem` directly but MUST
// refuse read-only collections first (`collectionWritable`) — the store
// deliberately exposes no write methods, so a "write through the store"
// can't be authored by accident.
//
// BACKWARD COMPATIBILITY — read before evolving this interface.
// This store is INTERNAL and may change shape, but two user-facing
// contracts built on top of it are effectively FROZEN, because they are
// consumed by LLM-authored custom-view HTML files that already live in
// users' workspaces (`data/skills/*/views/*.html`, `feeds/*/views/*.html`).
// Those files cannot be migrated centrally — there is no registry of them,
// and users expect a view authored months ago to keep working:
//
//   - the desktop view-data HTTP surface (`server/api/routes/collections.ts`:
//     GET `?fields=`/`?ids=`, PUT items, POST /query, POST /actions/<id>,
//     response shapes, error semantics) as documented in
//     `packages/core/assets/helps/custom-view.md`;
//   - the remote-view bridge (`../../remote-view/index.ts`: `__MC_VIEW`
//     protocol, `getItems` page shape `{ items, total, offset, limit }`,
//     mutate replies) as documented in
//     `packages/core/assets/helps/custom-view-remote.md`.
//
// Any storage-virtualization work (new backends, paging, capability
// changes) must be invisible at those two surfaces: evolve them by
// ADDITIVE, backward-compatible supersets only — never rename/repurpose
// params or message types, never change existing response shapes, never
// let a new backend alter what an existing view observes.

import type { CollectionItem } from "../core/schema";
import type { CollectionQuery } from "../core/queryZ";
import { isReadOnlySchema } from "../core/schema";
import type { LoadedCollection } from "./discoveredCollection";
import { listItems, readItem, type IoOptions } from "./io";
import { csvList, csvRead, csvRunQuery } from "./csvStore";

export interface CollectionStoreCapabilities {
  readonly writable: boolean;
  /** Native aggregation engine for the structured DSL (`core/queryZ.ts`).
   *  False ⇒ `query` is absent; the engine-level fallback (enrich →
   *  JSONL → DuckDB, `queryRunner.ts`) answers aggregations instead. */
  readonly nativeQuery: boolean;
  /** True when `page` resolves offset/limit inside the backend. False ⇒
   *  `page` is emulated (full read, then slice) — same result, no saving. */
  readonly nativePaging: boolean;
}

/** Options for `page`. STORED fields only — computed fields (`derived` /
 *  `toggle` / `embed` / rollups) never reach the store; project them at the
 *  engine level (`readPage.ts`) after enrichment. */
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

/** The storage contract every backend must satisfy (verified by the shared
 *  contract test suite, `test/workspace/collections/test_storeContract.ts`):
 *
 *  1. STABLE ORDER — `page` walks a documented deterministic order (file
 *     store: lexicographic by record id; CSV store: file row order), so
 *     `offset`-paging never skips or repeats records between calls. Sorting
 *     by arbitrary fields is NOT the store's job.
 *  2. IDS — minting/resolving record ids is the store's job (the CSV
 *     store's `id0x…` encoding stays inside it); `read` resolves every id
 *     `list`/`page` returned.
 *  3. CONTAINMENT — a store never serves data from outside the workspace;
 *     symlink/realpath defenses are each implementation's obligation
 *     (io.ts is the reference).
 *  4. HONEST AGGREGATION — `query`, when present, is computed over the
 *     WHOLE data set, never from a capped read. */
export interface CollectionStore {
  readonly capabilities: CollectionStoreCapabilities;
  /** Every record, in the store's stable order. CSV store: capped at
   *  `MAX_CSV_ROWS` (see csvStore.ts). Prefer `page` in new code. */
  list: () => Promise<CollectionItem[]>;
  /** One page of records — offset/limit/projection over the stable order. */
  page: (opts?: ListOptions) => Promise<ListPage>;
  /** One record by id, or null when missing/invalid. */
  read: (itemId: string) => Promise<CollectionItem | null>;
  /** Aggregation over the WHOLE data set (the structured DSL,
   *  `core/queryZ.ts`) — present only on stores with a native query
   *  engine (the CSV store). Absent ⇒ use the engine-level fallback
   *  (`runCollectionQuery`), never emulate ad hoc. */
  query?: (query: CollectionQuery) => Promise<Record<string, unknown>[]>;
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

/** The file store's stable order: lexicographic by record id (codepoint
 *  compare — locale-independent). `listItems` returns readdir order, which
 *  is filesystem-dependent; paging needs determinism. */
function sortByRecordId(items: CollectionItem[], primaryKey: string): CollectionItem[] {
  return [...items].sort((left, right) => (String(left[primaryKey] ?? "") < String(right[primaryKey] ?? "") ? -1 : 1));
}

/** True when the collection accepts UI/tool writes. A `dataSource`
 *  collection is read-only: updates happen by editing/replacing the
 *  data file itself. Every write entry point checks this BEFORE calling
 *  `writeItem`/`deleteItem` — server-enforced, not just UI-hidden. */
export function collectionWritable(collection: Pick<LoadedCollection, "schema">): boolean {
  return !isReadOnlySchema(collection.schema);
}

/** The one-line refusal write paths surface (HTTP 405 / MCP error text). */
export function readOnlyRefusal(slug: string): string {
  return `collection '${slug}' is read-only (backed by an external dataSource) — update the data file itself instead`;
}

/** A `dataSource` store over `file` (CSV row order; DuckDB-native query).
 *  A schema whose `dataSourceFile` failed to resolve yields a read-only
 *  EMPTY store rather than falling back to the (writable) file store — a
 *  half-loaded read-only collection must never become writable. */
function csvStoreFor(collection: LoadedCollection, opts: IoOptions): CollectionStore {
  const file = collection.dataSourceFile;
  const key = collection.schema.primaryKey;
  const listAll = () => (file === undefined ? Promise.resolve({ items: [], truncated: false }) : csvList(file, key, opts.workspaceRoot));
  return {
    capabilities: { writable: false, nativeQuery: true, nativePaging: false },
    list: () => listAll().then((result) => result.items),
    page: (pageOpts = {}) => listAll().then((result) => pageFromFullRead(result.items, pageOpts, key, result.truncated)),
    read: (itemId: string) => (file === undefined ? Promise.resolve(null) : csvRead(file, key, itemId, opts.workspaceRoot)),
    query: (query: CollectionQuery) => (file === undefined ? Promise.resolve([]) : csvRunQuery(file, key, query, opts.workspaceRoot)),
  };
}

/** The classic file store over `<dataDir>/<itemId>.json` records. */
function fileStoreFor(collection: LoadedCollection, opts: IoOptions): CollectionStore {
  const key = collection.schema.primaryKey;
  return {
    capabilities: { writable: true, nativeQuery: false, nativePaging: false },
    list: () => listItems(collection.dataDir, opts),
    page: async (pageOpts = {}) => pageFromFullRead(sortByRecordId(await listItems(collection.dataDir, opts), key), pageOpts, key, false),
    read: (itemId: string) => readItem(collection.dataDir, itemId, opts),
  };
}

/** Pick the store implementation for a discovered collection. */
export function storeFor(collection: LoadedCollection, opts: IoOptions = {}): CollectionStore {
  return isReadOnlySchema(collection.schema) ? csvStoreFor(collection, opts) : fileStoreFor(collection, opts);
}
