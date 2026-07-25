import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// deleteCollection — archives a restorable copy, then removes all three
// on-disk locations (staging skill, active mirror, records). Also pins
// the scope guards: user-scope and preset (`mc-*`) collections refuse.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { deleteCollection, storeFor, type LoadedCollection } from "@mulmoclaude/core/collection/server";
import type { CollectionSchema, CollectionSource } from "../../../server/workspace/collections/types.js";

let workdir: string;

function schemaFor(slug: string): CollectionSchema {
  return {
    title: "Restaurants",
    icon: "restaurant",
    dataPath: `data/${slug}/items`,
    primaryKey: "id",
    fields: { id: { type: "string", label: "ID", primary: true } },
  };
}

/** Lay down the three on-disk locations for `slug` and return the
 *  LoadedCollection a discovery pass would have produced. */
function seedCollection(slug: string, source: CollectionSource): LoadedCollection {
  const schema = schemaFor(slug);
  const stagingDir = path.join(workdir, "data", "skills", slug);
  const skillDir = path.join(workdir, ".claude", "skills", slug);
  const dataDir = path.join(workdir, "data", slug, "items");
  for (const dir of [stagingDir, skillDir, dataDir]) mkdirSync(dir, { recursive: true });
  for (const dir of [stagingDir, skillDir]) {
    writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema));
    writeFileSync(path.join(dir, "SKILL.md"), `# ${slug}`);
  }
  writeFileSync(path.join(dataDir, "acme.json"), JSON.stringify({ id: "acme" }));
  writeFileSync(path.join(dataDir, "globex.json"), JSON.stringify({ id: "globex" }));
  return { slug, source, schema, dataDir, skillDir };
}

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "collections-delete-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("deleteCollection", () => {
  it("archives a copy and removes all three locations", async () => {
    const collection = seedCollection("restaurants", "project");
    const result = await deleteCollection(collection, { workspaceRoot: workdir, dateStamp: "2026-05-31" });

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.ok(result.archivePath.startsWith(path.join("archive", "2026-05-31-")), `unexpected archivePath: ${result.archivePath}`);

    // All three sources are gone.
    assert.equal(existsSync(path.join(workdir, "data", "skills", "restaurants")), false, "staging skill remains");
    assert.equal(existsSync(path.join(workdir, ".claude", "skills", "restaurants")), false, "active mirror remains");
    assert.equal(existsSync(path.join(workdir, "data", "restaurants")), false, "records (and empty parent) remain");

    // The backup holds one skill copy, the records, and RESTORE.md.
    const archiveDir = path.join(workdir, result.archivePath);
    assert.ok(existsSync(path.join(archiveDir, "skill", "schema.json")), "archived schema.json missing");
    assert.ok(existsSync(path.join(archiveDir, "skill", "SKILL.md")), "archived SKILL.md missing");
    assert.ok(existsSync(path.join(archiveDir, "records", "acme.json")), "archived record missing");
    assert.ok(existsSync(path.join(archiveDir, "records", "globex.json")), "archived record missing");
    const restore = readFileSync(path.join(archiveDir, "RESTORE.md"), "utf-8");
    assert.match(restore, /restaurants/);
    assert.match(restore, /data\/restaurants\/items/);
  });

  it("refuses a user-scope collection (read-only) and leaves it intact", async () => {
    const collection = seedCollection("restaurants", "user");
    const result = await deleteCollection(collection, { workspaceRoot: workdir });
    assert.equal(result.kind, "user-scope");
    assert.equal(existsSync(path.join(workdir, "data", "skills", "restaurants")), true, "staging must survive a refused delete");
  });

  it("refuses a preset (mc-*) collection and leaves it intact", async () => {
    const collection = seedCollection("mc-invoice", "project");
    const result = await deleteCollection(collection, { workspaceRoot: workdir });
    assert.equal(result.kind, "preset");
    assert.equal(existsSync(path.join(workdir, ".claude", "skills", "mc-invoice")), true, "mirror must survive a refused delete");
  });

  it("deletes an imported collection whose dataPath lives under data/collections/<slug>/", async () => {
    // Regression: registry-imported collections have their dataPath
    // normalized to `data/collections/<slug>/items` (see
    // `normalizedDataPath` in importCollection.ts), not the authored
    // default `data/<slug>/items`. The safety check used to only accept
    // `data/<slug>/`, so importing-then-deleting always failed with
    // "unsafe-data-path". Both per-slug subtrees are equally per-collection.
    const slug = "movies-2";
    const stagingDir = path.join(workdir, "data", "skills", slug);
    const skillDir = path.join(workdir, ".claude", "skills", slug);
    const dataDir = path.join(workdir, "data", "collections", slug, "items");
    for (const dir of [stagingDir, skillDir, dataDir]) mkdirSync(dir, { recursive: true });
    const importedSchema: CollectionSchema = {
      title: "Movies",
      icon: "movie",
      dataPath: `data/collections/${slug}/items`,
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    };
    for (const dir of [stagingDir, skillDir]) {
      writeFileSync(path.join(dir, "schema.json"), JSON.stringify(importedSchema));
      writeFileSync(path.join(dir, "SKILL.md"), `# ${slug}`);
    }
    writeFileSync(path.join(dataDir, "casino-royale.json"), JSON.stringify({ id: "casino-royale" }));
    const collection: LoadedCollection = { slug, source: "project", schema: importedSchema, dataDir, skillDir };

    const result = await deleteCollection(collection, { workspaceRoot: workdir, dateStamp: "2026-06-28" });
    assert.equal(result.kind, "ok", `expected ok, got ${result.kind}`);

    // All three sources are gone — staging, mirror, records.
    assert.equal(existsSync(stagingDir), false, "staging skill remains");
    assert.equal(existsSync(skillDir), false, "active mirror remains");
    assert.equal(existsSync(dataDir), false, "records remain");
    assert.equal(existsSync(path.join(workdir, "data", "collections", slug)), false, "empty parent of records remains");

    if (result.kind === "ok") {
      const archiveDir = path.join(workdir, result.archivePath);
      assert.ok(existsSync(path.join(archiveDir, "skill", "schema.json")), "archived schema.json missing");
      assert.ok(existsSync(path.join(archiveDir, "records", "casino-royale.json")), "archived record missing");
    }
  });

  it("refuses a dataDir outside the per-collection subtree and deletes nothing", async () => {
    // A hostile/malformed schema points dataPath at the shared `data`
    // root, so loadCollection would resolve dataDir to <workdir>/data; a
    // recursive delete there would wipe every collection. The guard
    // validates the RESOLVED dataDir (not the schema string) and must
    // refuse BEFORE any archive/removal runs.
    const collection = seedCollection("restaurants", "project");
    const hostile: LoadedCollection = {
      ...collection,
      schema: { ...collection.schema, dataPath: "data" },
      dataDir: path.join(workdir, "data"),
    };
    const result = await deleteCollection(hostile, { workspaceRoot: workdir });
    assert.equal(result.kind, "unsafe-data-path");
    assert.equal(existsSync(path.join(workdir, "data", "skills", "restaurants")), true, "staging must survive");
    assert.equal(existsSync(path.join(workdir, ".claude", "skills", "restaurants")), true, "mirror must survive");
    assert.equal(existsSync(path.join(workdir, "data", "restaurants", "items")), true, "records must survive");
    assert.equal(existsSync(path.join(workdir, "archive")), false, "no archive should be written on refusal");
  });
});

describe("deleteCollection — storage (sqlite) collections", () => {
  /** Seed a sqlite-backed collection: skill files + a REAL db (written
   *  through the store) at data/<slug>/records.db, plus fake sidecar files
   *  so their removal is observable. */
  function seedStorageCollection(slug: string): LoadedCollection {
    const schema = {
      title: "Orders DB",
      icon: "receipt_long",
      storage: { type: "sqlite", path: `data/${slug}/records.db` },
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    } as unknown as CollectionSchema;
    const stagingDir = path.join(workdir, "data", "skills", slug);
    const skillDir = path.join(workdir, ".claude", "skills", slug);
    const dataDir = path.join(workdir, "data", "collections", slug, "items");
    for (const dir of [stagingDir, skillDir, dataDir]) mkdirSync(dir, { recursive: true });
    for (const dir of [stagingDir, skillDir]) {
      writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema));
      writeFileSync(path.join(dir, "SKILL.md"), `# ${slug}`);
    }
    const storageFile = path.join(workdir, "data", slug, "records.db");
    return { slug, source: "project" as CollectionSource, schema, dataDir, skillDir, storageFile } as LoadedCollection;
  }

  it("archives the db (checkpointed), removes the live file + sidecars, and writes storage restore steps", async () => {
    const collection = seedStorageCollection("ordersdb");
    const store = storeFor(collection, { workspaceRoot: workdir });
    assert.ok(store.write);
    assert.equal((await store.write("o1", { id: "o1" })).kind, "ok");
    assert.equal((await store.write("o2", { id: "o2" })).kind, "ok");
    const storageFile = collection.storageFile as string;
    // Observable sidecars: gone after delete whether or not the checkpoint ran.
    writeFileSync(`${storageFile}-wal`, "sidecar");
    writeFileSync(`${storageFile}-journal`, "sidecar");

    const result = await deleteCollection(collection, { workspaceRoot: workdir, dateStamp: "2026-07-19" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;

    const archiveDir = path.join(workdir, result.archivePath);
    // The db is archived under its basename and holds every committed record
    // (the pre-archive checkpoint folds WAL pages into the main file).
    const archivedDb = path.join(archiveDir, "records.db");
    assert.ok(existsSync(archivedDb), "archived db must exist");
    const archived = { ...collection, storageFile: archivedDb } as LoadedCollection;
    const rows = await storeFor(archived, { workspaceRoot: workdir }).list();
    assert.deepEqual(rows.map((row) => row.id).sort(), ["o1", "o2"]);

    // Live db + sidecars are gone; RESTORE.md tells how to bring it back.
    assert.equal(existsSync(storageFile), false);
    assert.equal(existsSync(`${storageFile}-wal`), false);
    assert.equal(existsSync(`${storageFile}-journal`), false);
    const restore = readFileSync(path.join(archiveDir, "RESTORE.md"), "utf-8");
    assert.ok(restore.includes("records.db"), "RESTORE.md must name the archived db file");
    assert.ok(restore.includes(`data/ordersdb/records.db`), "RESTORE.md must point at storage.path");
    assert.ok(restore.includes("(storage)"), "summary line must mark the storage backend");
  });
});

// #2550. The retrieval cursor lives in a SHARED dir outside every
// per-collection location, so nothing else would remove it. Left behind, a
// collection recreated under the same slug inherits `lastFetchedAt` and skips
// its initial fetch — it just sits empty until the next scheduled tick.
describe("deleteCollection — ingest state", () => {
  function seedIngestState(slug: string): string {
    const stateDir = path.join(workdir, "data", "ingest-state");
    mkdirSync(stateDir, { recursive: true });
    const stateFile = path.join(stateDir, `${slug}.json`);
    writeFileSync(stateFile, JSON.stringify({ slug, lastFetchedAt: "2026-07-01T00:00:00.000Z", cursor: { etag: "abc" }, consecutiveFailures: 3 }));
    return stateFile;
  }

  it("removes the collection's ingest state", async () => {
    const collection = seedCollection("daily-news", "project");
    const stateFile = seedIngestState("daily-news");

    const result = await deleteCollection(collection, { workspaceRoot: workdir, dateStamp: "2026-07-25" });

    assert.equal(result.kind, "ok");
    assert.equal(existsSync(stateFile), false, "ingest state survived the delete");
  });

  it("leaves another collection's ingest state alone", async () => {
    const collection = seedCollection("daily-news", "project");
    const otherState = seedIngestState("weekly-digest");

    await deleteCollection(collection, { workspaceRoot: workdir, dateStamp: "2026-07-25" });

    assert.equal(existsSync(otherState), true, "deleted the wrong collection's ingest state");
  });

  it("succeeds when there is no ingest state to remove", async () => {
    const collection = seedCollection("restaurants", "project");

    const result = await deleteCollection(collection, { workspaceRoot: workdir, dateStamp: "2026-07-25" });

    assert.equal(result.kind, "ok");
  });

  // Deliberate: the archive exists to restore user data, and restoring a stale
  // cursor would reintroduce the bug this delete is fixing.
  it("does NOT archive the ingest state", async () => {
    const collection = seedCollection("daily-news", "project");
    seedIngestState("daily-news");

    const result = await deleteCollection(collection, { workspaceRoot: workdir, dateStamp: "2026-07-25" });

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(existsSync(path.join(workdir, result.archivePath, "daily-news.json")), false);
  });
});
