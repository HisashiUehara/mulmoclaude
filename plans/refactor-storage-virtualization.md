# Collection storage virtualization — Stage 0–1

**Status**: Stage 0 in progress
**Owner**: TBD
**Last updated**: 2026-07-19

Prepare the collection engine for multiple storage backends by promoting the
existing `CollectionStore` seam (`packages/core/src/collection/server/store.ts`)
from a read-only convenience into the one boundary where "where do the rows
come from" is decided. No new backend is added in these stages — the two
existing implementations (per-record JSON file store, CSV/DuckDB `dataSource`
store) stay as they are; what changes is that the four concerns currently
leaking around the seam (write, query, paging, change events) get folded in,
stage by stage.

## Hard constraint — existing custom views must keep working

LLM-authored custom-view HTML files already persist in users' workspaces
(`data/skills/*/views/*.html`, `feeds/*/views/*.html`) and cannot be migrated
centrally. Two user-facing contracts are therefore FROZEN and every stage must
be invisible at these surfaces (source comments marking them:
`store.ts` header, the view-data section of `server/api/routes/collections.ts`,
and the `packages/core/src/remote-view/index.ts` header):

- **Desktop view-data HTTP contract** (`custom-view.md`): `?fields=` / `?ids=`
  semantics, `{ collection, count, items }` / `{ written, rejected }` /
  `{ rows }` shapes, status-code semantics (400 + `{ error }`, 403
  mutate-kind, 409 require-gate). Evolve by ADDITION only.
- **Remote-view bridge** (`custom-view-remote.md`): `__MC_VIEW` protocol, the
  `getItems` page shape `{ items, total, offset, limit }`, mutate replies.
  Evolve only by backward-compatible supersets + `REMOTE_VIEW_PROTOCOL` bump
  (the way v2 added the mutate pair).

## Current state (2026-07-19)

- `CollectionStore` = `{ capabilities: { writable }, list(), read(id), query?() }`,
  two impls picked by `storeFor` (`isReadOnlySchema` ⇒ CSV store).
- Writes bypass the store: `io.ts` `writeItem` / `deleteItem` called directly,
  guarded per-call-site by `collectionWritable`.
- Aggregation: native `query` on the CSV store only; file-backed collections
  aggregate via `manageTool.ts` special wiring (enrich → temp JSONL → DuckDB,
  `jsonlQuery.ts`) — placed there, not in `store.ts`, to avoid an import cycle
  with `derive.ts`.
- `list()` materializes everything; CSV capped at `MAX_CSV_ROWS` (5000) with a
  silent warn. Remote view re-paginates in memory.
- Change events (`publishCollectionChange`) are embedded in file-store writes.

## Stage 0 — route every read through `storeFor`

Pure refactor, behavior unchanged, no core API change (no version bump).

1. `server/remoteHost/handlers/getFeed.ts` — replace the direct
   `listItems(feed.dataDir)` with a `storeFor`-based `listRecords` injection,
   same shape as `getCollection.ts:33` already uses.
2. `server/workspace/collections/index.ts` — stop re-exporting the raw io
   readers; migrate its own direct read call sites to `storeFor`.
3. `server/workspace/collections/remoteView.ts` — the mutate path's existence
   check (`readItem`) moves to `store.read`. (`writeItem` / `deleteItem` stay
   direct until Stage 2.)
4. Enforcement: ESLint `no-restricted-imports` forbidding the read exports of
   `collection/server/io` outside `packages/core/src/collection/` (+ one line
   in `docs/lint-policy.md`).

## Stage 1 — widen the interface (same two stores)

Breaking change to core's exported types ⇒ minor bump of `@mulmoclaude/core`
in the same PR (+ launcher range lockstep), and a matching port in
MulmoTerminal's `server/backends` (a dep bump alone leaves dataSource
collections unopenable — see the engine-contract-port rule).

### 1-1. `CollectionStore` v2

```ts
export interface CollectionStoreCapabilities {
  readonly writable: boolean;
  readonly nativeQuery: boolean;  // false ⇒ engine-level fallback handles query
  readonly nativePaging: boolean; // false ⇒ list(opts) emulated by full read + slice
}

export interface ListOptions {
  offset?: number;                 // 0-based, over the store's stable order
  limit?: number;                  // absent = all (subject to store cap)
  fields?: readonly string[];      // STORED fields only (+ primaryKey, always)
}

export interface ListPage {
  items: CollectionItem[];
  total: number;                   // pre-paging count; lower bound when truncated
  truncated: boolean;              // store capped the scan (e.g. MAX_CSV_ROWS)
}

export interface CollectionStore {
  readonly capabilities: CollectionStoreCapabilities;
  list: (opts?: ListOptions) => Promise<ListPage>;
  read: (itemId: string) => Promise<CollectionItem | null>;
  query?: (query: CollectionQuery) => Promise<Record<string, unknown>[]>; // iff nativeQuery
}
```

Contract invariants (doc-comment on the interface; a new backend joins by
satisfying these + the contract test suite):

1. **Stable order** — `list` returns a documented deterministic order (file
   store: lexicographic by record id; CSV store: file row order). Sorting is
   NOT the store's job.
2. **Id minting/resolution is the store's job** (`id0x…` encoding stays inside
   the CSV store); `read(id)` resolves every id `list` returned.
3. **Never serve data outside the workspace** — symlink / containment defenses
   are each implementation's obligation (file store is the reference).
4. **`query` is correct over the WHOLE data set** — never computed from a
   capped `list`.

### 1-2. Engine-level helpers (above the store, below consumers)

- `readPage.ts` — `readPage(collection, { offset, limit, fields, sort })`:
  pushes down to `store.list(opts)` when possible (no sort, all-stored fields,
  `nativePaging`); otherwise full read → `enrichItems` → sort → slice →
  project. Rule: any computed field in `fields` ⇒ full-read path (no formula
  dependency analysis — big data goes through native `query` instead).
- `queryRunner.ts` — `runCollectionQuery(collection, query, opts)`: native
  `store.query` when present, else enrich + `runQueryOverRows`. Replaces the
  special wiring in `manageTool.ts#handleQueryItems` and backs the view-data
  `/query` route. Lives at the derive layer, so the old jsonlQuery/derive
  import-cycle concern disappears.

### 1-3. Caller migration

`list()` returning `ListPage` instead of `CollectionItem[]` is the one
breaking change; ~10 call sites become `(await store.list()).items`
mechanically. `ontology.ts` record count becomes
`(await store.list({ limit: 0 })).total` (drops a full materialization).

### 1-4. Store contract tests

One shared suite (`storeContract.test.ts`) run against both implementations:
stable order, offset/limit boundaries, `fields` projection + primaryKey
guarantee, `truncated` behavior, `read(list-id)` round-trip, `query` presence
matching `capabilities`. This is what makes a future third backend cheap.

### PR slicing

- **PR-A (Stage 0)**: call-site consolidation + ESLint rule. Behavior
  unchanged.
- **PR-B**: `ListPage` / `ListOptions` + both store impls + contract tests +
  mechanical caller migration + core minor bump.
- **PR-C**: `readPage` / `queryRunner`; move manageTool, routes, remoteView
  onto them (remote view's in-memory paging replaced by `readPage`).

## Later stages (sketch, not in scope here)

- **Stage 2**: writes into the store as presence-based capability
  (`write?` / `delete?` exist only on writable stores; `readOnlyRefusal`
  semantics preserved; `publishCollectionChange` moves in — feeds pruning and
  google calendar-sync deletes then publish change events too).
- **Stage 3**: explicit `storage` discriminated union in the schema + store
  factory registry in core (factories live in core, per the dependency-
  direction rule — no plugin-registered backends).
- **Stage 4**: first non-file writable backend (e.g. SQLite) to validate the
  abstraction — stresses write / native query / native paging / change events
  at once. `nativeSort` capability considered here, not before.

## Open questions

1. Keep "`list()` with no opts = everything (honest `truncated`)" vs a separate
   explicit `readAll` method. Current plan: the former.
2. Sort pushdown timing — deferred to Stage 4 (design against a real backend).
3. Feeds: file-store-only code (`feeds/server/engine.ts` direct `deleteItem`)
   is Stage 2 scope; Stage 0–1 aligns reads only.
