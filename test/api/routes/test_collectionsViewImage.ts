// The view-data image route's authorization set: a scoped view token may
// resolve exactly the workspace paths that are CURRENT values of the
// schema's image-type fields — nothing else. Pins the set-building rules
// (image fields only, top-level only, non-empty strings only) so the route
// can never regress into an arbitrary-file oracle.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { imageFieldPathValues } from "../../../server/api/routes/collections.js";
import type { LoadedCollection } from "../../../server/workspace/collections/index.js";

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

describe("imageFieldPathValues", () => {
  it("collects only image-type field values, skipping empties and non-strings", () => {
    const paths = imageFieldPathValues(schema, [
      { id: "a", name: "A", logo: "data/teams/logos/a.png", banner: "" },
      { id: "b", name: "B", logo: "data/teams/logos/b.png", banner: 42, site: "data/evil/not-image.png" },
      { id: "c", name: "C" },
    ]);
    assert.deepEqual([...paths].sort(), ["data/teams/logos/a.png", "data/teams/logos/b.png"]);
  });

  it("never authorizes a non-image field's value, even when it looks like a path", () => {
    const paths = imageFieldPathValues(schema, [{ id: "a", site: "data/attachments/secret.png" }]);
    assert.equal(paths.has("data/attachments/secret.png"), false);
    assert.equal(paths.size, 0);
  });

  it("is empty for a schema with no image fields", () => {
    const bare = { ...schema, fields: { id: { type: "string", label: "ID", primary: true } } } as unknown as Schema;
    assert.equal(imageFieldPathValues(bare, [{ id: "a", logo: "data/x.png" }]).size, 0);
  });
});
