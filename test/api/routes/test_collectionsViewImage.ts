// The view-data image route: the authorization rule (a scoped view token
// may resolve exactly the paths that are CURRENT values of the schema's
// image-type fields — nothing else) and the HTTP handler contract behind
// the deps seam (400 missing path / 404 unknown collection / 404
// unauthorized path / 404 unresolvable / clamped maxEdge plumbing / 500 on
// a thrown resolver). Token-middleware behavior itself is pinned by
// test_viewToken.ts (requireViewToken + the isViewDataPath bearer
// exemption this route depends on — Codex P1 on #2204).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";

import { createViewDataImageHandler, isAuthorizedImagePath, type ViewDataImageDeps } from "../../../server/api/routes/collections.js";
import type { CollectionItem, LoadedCollection } from "../../../server/workspace/collections/index.js";

type Schema = LoadedCollection["schema"];

const schema = {
  title: "Teams",
  icon: "sports",
  dataPath: "data/teams/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true },
    name: { type: "string", label: "Name" },
    logo: { type: "image", label: "Logo" },
    banner: { type: "image", label: "Banner" },
    site: { type: "string", label: "Site" },
  },
} as unknown as Schema;

const collection = { slug: "teams", source: "project", schema, dataDir: "/d/teams", skillDir: "/s/teams" } as unknown as LoadedCollection;

const records: CollectionItem[] = [
  { id: "a", name: "A", logo: "data/teams/logos/a.png", banner: "" },
  { id: "b", name: "B", logo: "data/teams/logos/b.png", banner: 42, site: "data/evil/not-image.png" },
  { id: "c", name: "C" },
];

describe("isAuthorizedImagePath", () => {
  it("authorizes only image-type field values, skipping empties and non-strings", () => {
    assert.equal(isAuthorizedImagePath(schema, records, "data/teams/logos/a.png"), true);
    assert.equal(isAuthorizedImagePath(schema, records, "data/teams/logos/b.png"), true);
    assert.equal(isAuthorizedImagePath(schema, records, "data/teams/logos/zz.png"), false);
    assert.equal(isAuthorizedImagePath(schema, records, ""), false);
  });

  it("never authorizes a non-image field's value, even when it looks like a path", () => {
    assert.equal(isAuthorizedImagePath(schema, records, "data/evil/not-image.png"), false);
  });

  it("is false for a schema with no image fields", () => {
    const bare = { ...schema, fields: { id: { type: "string", label: "ID", primary: true } } } as unknown as Schema;
    assert.equal(isAuthorizedImagePath(bare, [{ id: "a", logo: "data/x.png" }], "data/x.png"), false);
  });
});

function fakeReq(slug: string, query: Record<string, unknown>): Request<{ slug: string }> {
  return { params: { slug }, query } as unknown as Request<{ slug: string }>;
}

function fakeRes() {
  let statusCode = 200;
  let body: unknown;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (payload: unknown) => {
      body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, status: () => statusCode, body: () => body as Record<string, unknown> | undefined };
}

function deps(overrides: Partial<ViewDataImageDeps> = {}): ViewDataImageDeps {
  return {
    loadCollection: async (slug) => (slug === "teams" ? collection : null),
    listRecords: async () => records,
    resolveThumbnail: async () => "data:image/jpeg;base64,THUMB",
    ...overrides,
  };
}

describe("createViewDataImageHandler", () => {
  it("resolves an authorized path into { path, dataUrl }", async () => {
    const { res, status, body } = fakeRes();
    await createViewDataImageHandler(deps())(fakeReq("teams", { path: "data/teams/logos/a.png" }), res);
    assert.equal(status(), 200);
    assert.deepEqual(body(), { path: "data/teams/logos/a.png", dataUrl: "data:image/jpeg;base64,THUMB" });
  });

  it("clamps maxEdge before it reaches the resolver (default 512, ceiling 1024, floor 64)", async () => {
    const seen: number[] = [];
    const handler = createViewDataImageHandler(
      deps({
        resolveThumbnail: async (_path, maxEdge) => {
          seen.push(maxEdge);
          return "data:image/jpeg;base64,T";
        },
      }),
    );
    const request = (query: Record<string, unknown>) => handler(fakeReq("teams", { path: "data/teams/logos/a.png", ...query }), fakeRes().res);
    await request({});
    await request({ maxEdge: "99999" });
    await request({ maxEdge: "1" });
    assert.deepEqual(seen, [512, 1024, 64]);
  });

  it("404s an unknown collection, an unauthorized path, and an unresolvable image; 400s a missing path", async () => {
    const run = async (slug: string, query: Record<string, unknown>, override: Partial<ViewDataImageDeps> = {}) => {
      const { res, status } = fakeRes();
      await createViewDataImageHandler(deps(override))(fakeReq(slug, query), res);
      return status();
    };
    assert.equal(await run("ghost", { path: "data/teams/logos/a.png" }), 404);
    assert.equal(await run("teams", { path: "data/evil/not-image.png" }), 404); // non-image field value
    assert.equal(await run("teams", { path: "data/teams/logos/a.png" }, { resolveThumbnail: async () => null }), 404);
    assert.equal(await run("teams", {}), 400);
  });

  it("500s with a fixed message when the record scan or resolver throws", async () => {
    const { res, status, body } = fakeRes();
    await createViewDataImageHandler(
      deps({
        listRecords: async () => {
          throw new Error("boom with /absolute/host/path");
        },
      }),
    )(fakeReq("teams", { path: "data/teams/logos/a.png" }), res);
    assert.equal(status(), 500);
    assert.equal((body() as { error?: string }).error, "image resolve failed"); // never the raw error text
  });
});
