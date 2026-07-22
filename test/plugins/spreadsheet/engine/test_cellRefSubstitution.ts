// Substituting cell values into a formula. The failure this covers produced a
// NUMBER — `=A1+A10` came back 55 instead of 12 — so there was nothing in the
// sheet to suggest anything had gone wrong.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, renderOperand, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

/** A single column of values, with `formula` in the cell beside the first. */
function columnSheet(values: (string | number)[], formula: string): SheetData {
  return { name: "S", data: values.map((value, index) => (index === 0 ? [{ v: value }, { v: formula }] : [{ v: value }])) };
}

const evaluate = (sheet: SheetData): unknown => new SpreadsheetEngine().calculate(sheet).data[0][1];

describe("cell reference substitution — prefix collisions", () => {
  // A global string replace rewrote every occurrence of the shorter reference
  // first, turning `A10` into `<A1's value>0`: 5 and 7 became "5+50" = 55.
  it("does not let A1 rewrite A10", () => {
    const values = [5, 0, 0, 0, 0, 0, 0, 0, 0, 7];
    assert.equal(evaluate(columnSheet(values, "=A1+A10")), 12);
  });

  it("does not let A1 rewrite A11 or A100", () => {
    const values = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4];
    assert.equal(evaluate(columnSheet(values, "=A1+A11")), 7);
  });

  it("keeps the order of a reference used twice", () => {
    const values = [2, 0, 0, 0, 0, 0, 0, 0, 0, 9];
    assert.equal(evaluate(columnSheet(values, "=A10-A1")), 7);
  });

  // The column letters collide the same way: `B1` is a prefix of `AB1` only in
  // the substring sense, and the old replace did not care about boundaries.
  it("does not let B1 rewrite AB1", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 0 }, { v: 2 }, { v: "=B1+AB1" }]] };
    assert.equal(new SpreadsheetEngine().calculate(sheet).data[0][2], 2, "AB1 is empty, so the sum is B1 alone");
  });

  it("handles several colliding references in one formula", () => {
    const values = [1, 2, 0, 0, 0, 0, 0, 0, 0, 10, 11];
    assert.equal(evaluate(columnSheet(values, "=A1+A2+A10+A11")), 24);
  });
});

describe("a lone reference returns the cell value unchanged", () => {
  // `=A1` is not an expression to substitute into — it IS the cell. Rendering
  // the value into expression text first would escape a string's quotes and
  // backslashes, and those escapes would survive into the result (Codex
  // review): `=A1` on `say "hi"` came back `say \"hi\"`.
  it("returns text with quotes and backslashes intact", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 'say "hi"' }, { v: "=A1" }, { v: "=$A$1" }]] };
    const [row] = new SpreadsheetEngine().calculate(sheet).data;
    assert.equal(row[1], 'say "hi"');
    assert.equal(row[2], 'say "hi"', "absolute form too");
  });

  it("returns a backslash-bearing string intact", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: "C:\\path" }, { v: "=A1" }]] };
    assert.equal(new SpreadsheetEngine().calculate(sheet).data[0][1], "C:\\path");
  });

  it("returns a number, not its string form", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 42 }, { v: "=A1" }]] };
    assert.equal(new SpreadsheetEngine().calculate(sheet).data[0][1], 42);
  });

  // The fast path is only for a formula that is EXACTLY one reference; the
  // moment it is part of an expression the substitution path takes over.
  it("does not take the fast path when the reference is part of an expression", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 3 }, { v: "=A1+1" }]] };
    assert.equal(new SpreadsheetEngine().calculate(sheet).data[0][1], 4);
  });
});

describe("renderOperand", () => {
  it("renders numbers and booleans verbatim", () => {
    assert.equal(renderOperand(42), "42");
    assert.equal(renderOperand(-3.5), "-3.5");
    assert.equal(renderOperand(0), "0");
    assert.equal(renderOperand(true), "true");
  });

  // Quoting is what keeps a text cell from being read as an identifier or an
  // operator once it lands in the expression.
  it("quotes strings", () => {
    assert.equal(renderOperand("hello"), '"hello"');
    assert.equal(renderOperand(""), '""');
  });

  // Without escaping, a cell containing a quote closes the literal early and
  // the rest of its text becomes expression source.
  it("escapes quotes and backslashes so the literal cannot be closed early", () => {
    assert.equal(renderOperand('say "hi"'), '"say \\"hi\\""');
    assert.equal(renderOperand("back\\slash"), '"back\\\\slash"');
    assert.equal(renderOperand('"'), '"\\""');
  });

  // Blanks are 0 here, as they are everywhere else in the engine.
  it("renders a missing value as 0", () => {
    assert.equal(renderOperand(null), "0");
    assert.equal(renderOperand(undefined), "0");
  });
});
