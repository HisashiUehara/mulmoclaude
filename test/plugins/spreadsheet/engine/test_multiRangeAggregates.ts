// Aggregates over more than one argument. Excel takes up to 255 (`SUM(A1:A2,
// B1:B2)`, `SUM(A1:A2, 10)`), but eight of these functions were registered with
// `maxArgs: 1` and read only `args[0]`, so the second range made the whole
// formula fail — a loud `#ERROR!` on ordinary spreadsheet usage (#2360).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

// A = 1,2 ; B = 3,4 ; the formula sits in C1.
const evaluate = (formula: string): unknown => {
  const sheet: SheetData = {
    name: "S",
    data: [
      [{ v: 1 }, { v: 3 }, { v: formula }],
      [{ v: 2 }, { v: 4 }],
    ],
  };
  return new SpreadsheetEngine().calculate(sheet).data[0][2];
};

describe("aggregates accept several ranges", () => {
  it("sums two ranges", () => {
    assert.equal(evaluate("=SUM(A1:A2,B1:B2)"), 10);
  });

  it("averages across two ranges", () => {
    assert.equal(evaluate("=AVERAGE(A1:A2,B1:B2)"), 2.5);
  });

  it("counts numbers across two ranges", () => {
    assert.equal(evaluate("=COUNT(A1:A2,B1:B2)"), 4);
  });

  it("counts non-empty cells across two ranges", () => {
    assert.equal(evaluate("=COUNTA(A1:A2,B1:B2)"), 4);
  });

  it("takes the median across two ranges", () => {
    assert.equal(evaluate("=MEDIAN(A1:A2,B1:B2)"), 2.5);
  });
});

describe("aggregates mix ranges with plain values", () => {
  it("sums a range plus a literal", () => {
    assert.equal(evaluate("=SUM(A1:A2,10)"), 13);
  });

  it("sums a range plus a single cell reference", () => {
    assert.equal(evaluate("=SUM(A1:A2,B1)"), 6);
  });
});

describe("the single-range behaviour is unchanged", () => {
  it("sums, averages and counts one range as before", () => {
    assert.equal(evaluate("=SUM(A1:A2)"), 3);
    assert.equal(evaluate("=AVERAGE(A1:A2)"), 1.5);
    assert.equal(evaluate("=COUNT(A1:A2)"), 2);
  });
});
