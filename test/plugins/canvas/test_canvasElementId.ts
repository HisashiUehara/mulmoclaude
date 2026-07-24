import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canvasElementId } from "../../../src/plugins/canvas/canvasElementId.js";

describe("canvasElementId", () => {
  it("builds a per-uuid id", () => {
    assert.equal(canvasElementId("result-canvas-1", 0), "vdc-result-canvas-1-0");
  });

  // Regression: two instances must get DISTINCT ids so the library's
  // `querySelector('#'+canvasId)` can't resolve one canvas for both.
  it("gives two different uuids different ids", () => {
    assert.notEqual(canvasElementId("a", 0), canvasElementId("b", 0));
  });

  it("changes with the remount counter so a resize gets a fresh element", () => {
    assert.notEqual(canvasElementId("a", 0), canvasElementId("a", 1));
  });

  it("falls back to 'default' for null/undefined uuid", () => {
    assert.equal(canvasElementId(null, 0), "vdc-default-0");
    assert.equal(canvasElementId(undefined, 2), "vdc-default-2");
  });

  // The id feeds `querySelector('#'+id)`, so it must stay a valid
  // selector target — characters outside [A-Za-z0-9_-] are replaced.
  it("sanitises characters that would break a CSS selector", () => {
    const elementId = canvasElementId("a/b.c:d 1", 0);
    assert.equal(elementId, "vdc-a-b-c-d-1-0");
    assert.ok(/^[A-Za-z0-9_-]+$/.test(elementId));
  });

  it("is stable for the same inputs", () => {
    assert.equal(canvasElementId("x", 3), canvasElementId("x", 3));
  });
});
