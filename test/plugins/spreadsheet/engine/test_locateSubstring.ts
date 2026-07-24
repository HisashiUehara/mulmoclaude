// locateSubstring folds the shared body of FIND (case-sensitive) and SEARCH
// (case-insensitive) (#2482): identical 0-based start, identical 1-based hit
// index, identical #VALUE! miss. Case folding is the ONLY axis that may differ,
// so these pin both the common rule and that one deliberate asymmetry.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { locateSubstring } from "../../../../src/plugins/spreadsheet/engine/functions/text.ts";
import { isSpreadsheetErrorValue } from "../../../../src/plugins/spreadsheet/engine/spreadsheet-errors.ts";

const CASE_SENSITIVE = { caseInsensitive: false };
const CASE_INSENSITIVE = { caseInsensitive: true };

const missed = (result: ReturnType<typeof locateSubstring>): boolean => isSpreadsheetErrorValue(result) && result.code === "#VALUE!";

describe("locateSubstring — 1-based hit index", () => {
  it("returns the 1-based position of the first match", () => {
    assert.equal(locateSubstring("b", "abc", 0, CASE_SENSITIVE), 2);
  });

  it("finds a match at the very start", () => {
    assert.equal(locateSubstring("a", "abc", 0, CASE_SENSITIVE), 1);
  });

  it("honours a non-zero start, skipping an earlier match", () => {
    assert.equal(locateSubstring("a", "banana", 2, CASE_SENSITIVE), 4);
  });
});

describe("locateSubstring — case sensitivity is the only difference", () => {
  it("case-sensitive: a wrong-case needle misses with #VALUE!", () => {
    assert.ok(missed(locateSubstring("O", "hello", 0, CASE_SENSITIVE)));
  });

  it("case-insensitive: the same wrong-case needle matches", () => {
    assert.equal(locateSubstring("O", "hello", 0, CASE_INSENSITIVE), 5);
  });

  it("case-insensitive folds BOTH the needle and the haystack", () => {
    assert.equal(locateSubstring("HELLO", "hello world", 0, CASE_INSENSITIVE), 1);
  });
});

describe("locateSubstring — misses and edge cases", () => {
  it("a needle absent from the haystack is #VALUE!", () => {
    assert.ok(missed(locateSubstring("z", "abc", 0, CASE_SENSITIVE)));
  });

  it("an empty needle matches at position 1 (indexOf semantics preserved)", () => {
    assert.equal(locateSubstring("", "abc", 0, CASE_SENSITIVE), 1);
  });
});
