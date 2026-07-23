// MODE's rule in isolation (#2391): the most frequent value, or #N/A when nothing
// repeats. The old handler returned the FIRST value for an all-distinct set, a
// silent wrong answer that reads like a real mode.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMode, sampleVariance, sampleStdev } from "../../../../src/plugins/spreadsheet/engine/functions/statistical-math.ts";
import { NA_ERROR, DIV_ZERO_ERROR } from "../../../../src/plugins/spreadsheet/engine/spreadsheet-errors.ts";

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

// STDEV / VAR are Excel's SAMPLE estimators: divide by n-1, not n. The old
// handler divided by n (the POPULATION estimator, Excel's STDEVP / VARP), a
// silent understatement of the spread (#2360).

describe("sampleVariance", () => {
  // {2,4,4,4,5,5,7,9}: mean 5, Σ(x-μ)² = 32. Sample 32/7 vs population 32/8 = 4.
  it("divides the summed squared deviations by n-1", () => {
    assert.equal(sampleVariance([2, 4, 4, 4, 5, 5, 7, 9]), 32 / 7);
  });

  it("gives 0.5 for two values one apart, not the population 0.25", () => {
    assert.equal(sampleVariance([1, 2]), 0.5);
  });

  it("returns #DIV/0! for a single value (no n-1)", () => {
    assert.equal(sampleVariance([5]), DIV_ZERO_ERROR);
  });

  it("returns #DIV/0! for an empty set", () => {
    assert.equal(sampleVariance([]), DIV_ZERO_ERROR);
  });
});

describe("sampleStdev", () => {
  it("is the square root of the sample variance", () => {
    const result = sampleStdev([2, 4, 4, 4, 5, 5, 7, 9]);
    assert.equal(typeof result, "number");
    assert.ok(Math.abs((result as number) - Math.sqrt(32 / 7)) < 1e-12);
  });

  it("propagates #DIV/0! from the fewer-than-two boundary", () => {
    assert.equal(sampleStdev([5]), DIV_ZERO_ERROR);
    assert.equal(sampleStdev([]), DIV_ZERO_ERROR);
  });
});
