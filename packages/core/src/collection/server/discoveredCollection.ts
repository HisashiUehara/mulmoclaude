import type { CollectionSchema, CollectionSource } from "../core/schema";

/** A collection discovered + loaded from disk: its schema plus the resolved
 *  on-disk locations. Produced by the host's discovery layer (which supplies
 *  the workspace scan) and consumed by the storage / validation engine.
 *
 *  The host's `discovery.ts` re-exports this type so its many existing
 *  importers keep resolving it from there. */
export interface LoadedCollection {
  slug: string;
  source: CollectionSource;
  schema: CollectionSchema;
  /** Absolute path to the resolved dataPath directory (inside the workspace).
   *  May not exist yet — the data folder is created on first write. For a
   *  `dataSource` collection this is the conventional per-slug dir
   *  (`data/collections/<slug>/items`) — records never live there (they're
   *  rows of `dataSourceFile`), but delete/archive paths stay well-defined. */
  dataDir: string;
  /** Absolute path to the external data file (schema `dataSource.path`,
   *  resolved with the same workspace containment as dataDir). Present iff
   *  the schema declares `dataSource` — i.e. iff the collection is
   *  read-only and its records come from the CSV store. */
  dataSourceFile?: string;
  /** Absolute path to the alternative-backend data file (schema
   *  `storage.path`, e.g. a SQLite database — same containment as dataDir).
   *  Present iff the schema declares `storage`. */
  storageFile?: string;
  /** Absolute path to the skill directory this collection was loaded from
   *  (`<skillsRoot>/<slug>/`). Action templates are read from here, path-safely. */
  skillDir: string;
}
