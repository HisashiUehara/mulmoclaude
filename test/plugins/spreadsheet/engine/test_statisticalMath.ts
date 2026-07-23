// MODE's rule in isolation (#2391): the most frequent value, or #N/A when nothing
// repeats. The old handler returned the FIRST value for an all-distinct set, a
// silent wrong answer that reads like a real mode.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMode, NA_ERROR } from "../../../../src/plugins/spreadsheet/engine/functions/statistical-math.ts";

describe("computeMode", () => {
  it("returns the single most frequent value", () => {
    assert.equal(computeMode([1, 2, 2, 3]), 2);
    assert.equal(computeMode([5, 5, 5, 1, 2]), 5);
  });

  // The fix: no value repeats, so the mode is undefined → #N/A, not values[0].
  it("returns #N/A when every value is distinct", () => {
    assert.equal(computeMode([1, 2, 3]), NA_ERROR);
    assert.equal(computeMode([9]), NA_ERROR);
  });

  it("returns #N/A for an empty set", () => {
    assert.equal(computeMode([]), NA_ERROR);
  });

  // On a tie the earliest-appearing value wins (Map preserves insertion order).
  it("breaks a frequency tie toward the first-appearing value", () => {
    assert.equal(computeMode([2, 2, 1, 1]), 2);
    assert.equal(computeMode([1, 1, 2, 2]), 1);
  });

  it("counts repeated negatives and zeros", () => {
    assert.equal(computeMode([0, 0, 1]), 0);
    assert.equal(computeMode([-3, -3, 4]), -3);
  });
});
