// Engine-level aggregation runner: ONE entry point for the structured
// query DSL (`core/queryZ.ts`) over any collection, regardless of its
// storage backend. Native when the store has a query engine (the CSV
// store scans the whole file in DuckDB); otherwise the shared fallback —
// enrich the full record set (computed fields become real columns) and
// run the same compiled SQL over a temp JSONL (`jsonlQuery.ts`).
//
// Callers (manageCollection's queryItems, which also backs the desktop
// custom view's `/query` route) go through here so the two engines can
// never drift — and so a future backend gets aggregation for free by
// either declaring `nativeQuery` or doing nothing.
//
// Lives at the derive layer (above the store), which is what resolves the
// old wiring note in jsonlQuery.ts: enrichment consumes `storeFor`, so
// this could never live inside `store.ts` without an import cycle.

import type { CollectionQuery } from "../core/queryZ";
import type { LoadedCollection } from "./discoveredCollection";
import type { DiscoveryOptions } from "./discovery";
import { enrichItems } from "./derive";
import { runQueryOverRows } from "./jsonlQuery";
import { storeFor } from "./store";

export async function runCollectionQuery(
  collection: LoadedCollection,
  query: CollectionQuery,
  opts: DiscoveryOptions = {},
): Promise<Record<string, unknown>[]> {
  const store = storeFor(collection, { workspaceRoot: opts.workspaceRoot });
  if (store.query) return store.query(query);
  // File-backed: load through the guarded reader (symlink defenses) and
  // enrich BEFORE DuckDB sees anything — a raw read_json over the record
  // files would both follow symlinks and miss every computed field.
  const enriched = await enrichItems(collection, await store.list(), opts);
  return runQueryOverRows(enriched, query);
}
