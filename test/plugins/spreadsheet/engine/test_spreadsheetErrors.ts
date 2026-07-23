// Recognising the engine's error values. IFERROR relies on this: once math
// functions return "#NUM!" / "#DIV/0!" strings instead of NaN, the old
// NaN-only check would let those errors slip through (#2389).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSpreadsheetError, isErrorResult } from "../../../../src/plugins/spreadsheet/engine/spreadsheet-errors.ts";

describe("isSpreadsheetError", () => {
  it("recognises the Excel error strings", () => {
    assert.equal(isSpreadsheetError("#NUM!"), true);
    assert.equal(isSpreadsheetError("#DIV/0!"), true);
    assert.equal(isSpreadsheetError("#N/A"), true);
  });

  it("rejects ordinary text and non-strings", () => {
    assert.equal(isSpreadsheetError("hello"), false);
    assert.equal(isSpreadsheetError("#NOPE!"), false);
    assert.equal(isSpreadsheetError(0), false);
    assert.equal(isSpreadsheetError(null), false);
  });
});

describe("isErrorResult", () => {
  it("treats error strings, NaN/∞ and missing values as errors", () => {
    assert.equal(isErrorResult("#DIV/0!"), true);
    assert.equal(isErrorResult(NaN), true);
    assert.equal(isErrorResult(Infinity), true);
    assert.equal(isErrorResult(null), true);
    assert.equal(isErrorResult(undefined), true);
  });

  it("passes ordinary values through", () => {
    assert.equal(isErrorResult(0), false);
    assert.equal(isErrorResult(42), false);
    assert.equal(isErrorResult("text"), false);
  });
});
