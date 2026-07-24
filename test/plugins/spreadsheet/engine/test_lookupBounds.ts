// VLOOKUP's col_index_num and HLOOKUP's row_index_num were used unchecked, so an
// index past the table addressed a cell OUTSIDE the range and returned whatever
// lived there — usually a silent 0 where Excel reports #REF! (#2360). INDEX
// already had this guard; these two did not.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTableOffset } from "../../../../src/plugins/spreadsheet/engine/formulaRefs.ts";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

// A1:B2 = [a, 1] / [b, 2]; the formula sits in C1.
const table = (formula: string): unknown => {
  const sheet: SheetData = {
    name: "S",
    data: [
      [{ v: "a" }, { v: 1 }, { v: formula }],
      [{ v: "b" }, { v: 2 }],
    ],
  };
  return new SpreadsheetEngine().calculate(sheet).data[0][2];
};

describe("resolveTableOffset", () => {
  it("maps a 1-based position to a 0-based offset", () => {
    assert.equal(resolveTableOffset(1, 2), 0);
    assert.equal(resolveTableOffset(2, 2), 1);
  });

  it("rejects a position past the table", () => {
    assert.equal(resolveTableOffset(3, 2), null);
    assert.equal(resolveTableOffset(9, 2), null);
  });

  it("rejects zero and negative positions", () => {
    assert.equal(resolveTableOffset(0, 2), null);
    assert.equal(resolveTableOffset(-1, 2), null);
  });

  it("rejects a non-finite position", () => {
    assert.equal(resolveTableOffset(NaN, 2), null);
  });

  it("truncates a fractional position toward zero, as Excel does", () => {
    assert.equal(resolveTableOffset(2.9, 2), 1);
  });
});

describe("VLOOKUP column bounds", () => {
  it("is #REF! when the column index is past the table", () => {
    assert.equal(table('=VLOOKUP("a",A1:B2,9,FALSE)'), "#REF!");
  });

  it("is #REF! for a zero or negative column index", () => {
    assert.equal(table('=VLOOKUP("a",A1:B2,0,FALSE)'), "#REF!");
    assert.equal(table('=VLOOKUP("a",A1:B2,-1,FALSE)'), "#REF!");
  });

  it("still returns the value for an in-range column", () => {
    assert.equal(table('=VLOOKUP("b",A1:B2,1,FALSE)'), "b", "column 1 is the key column");
    assert.equal(table('=VLOOKUP("b",A1:B2,2,FALSE)'), 2);
  });

  it("still reports #N/A when the key is not found", () => {
    assert.equal(table('=VLOOKUP("zz",A1:B2,2,FALSE)'), "#N/A", "a missing key is not a #REF!");
  });
});

describe("HLOOKUP row bounds", () => {
  it("is #REF! when the row index is past the table", () => {
    assert.equal(table('=HLOOKUP("a",A1:B2,9,FALSE)'), "#REF!");
  });

  it("still returns the value for an in-range row", () => {
    assert.equal(table('=HLOOKUP("a",A1:B2,2,FALSE)'), "b");
  });
});
