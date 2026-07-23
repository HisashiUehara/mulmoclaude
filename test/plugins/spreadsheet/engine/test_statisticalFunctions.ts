// STDEV / VAR through the whole engine (#2360). Excel's STDEV / VAR are the
// SAMPLE estimators (divide by n-1); the engine used to divide by n, which is
// the POPULATION estimator (Excel's STDEVP / VARP) — a silent wrong answer.
// A single value has no n-1 to divide by, so Excel reports #DIV/0!.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine } from "../../../../src/plugins/spreadsheet/engine/index.ts";

/** Calculate `formula` in the cell just below a single column of `values`. */
const evalOverColumn = (values: number[], formula: string): unknown => {
  const data: { v: string | number }[][] = values.map((value) => [{ v: value }]);
  data.push([{ v: formula }]);
  const result = new SpreadsheetEngine().calculate({ name: "S", data });
  return result.data[data.length - 1][0];
};

// {2,4,4,4,5,5,7,9}: mean 5, Σ(x-μ)² = 32.
// Sample:     32 / (8-1) = 4.5714… → stdev 2.1380…
// Population: 32 / 8      = 4       → stdev 2.0 (the old wrong answer).
const SAMPLE_VALUES = [2, 4, 4, 4, 5, 5, 7, 9];

describe("STDEV — sample estimator (#2360)", () => {
  it("divides by n-1, not n", () => {
    const result = evalOverColumn(SAMPLE_VALUES, "=STDEV(A1:A8)");
    assert.equal(typeof result, "number");
    assert.ok(Math.abs((result as number) - 2.138089935) < 1e-6, `expected ~2.1381 sample stdev, got ${result}`);
  });

  it("returns #DIV/0! for a single value (no n-1 to divide by)", () => {
    assert.equal(evalOverColumn([42], "=STDEV(A1:A1)"), "#DIV/0!");
  });
});

describe("VAR — sample estimator (#2360)", () => {
  it("divides by n-1, not n", () => {
    const result = evalOverColumn(SAMPLE_VALUES, "=VAR(A1:A8)");
    assert.equal(typeof result, "number");
    assert.ok(Math.abs((result as number) - 32 / 7) < 1e-9, `expected 32/7 sample variance, got ${result}`);
  });

  it("returns #DIV/0! for a single value", () => {
    assert.equal(evalOverColumn([42], "=VAR(A1:A1)"), "#DIV/0!");
  });
});
