// serialFromParts folds the validate -> Date.UTC -> dateToSerial tail that every
// dated branch of parseDate repeated (#2482). parseDate now delegates to it, so
// pinning the rule directly here is the only place a wrong month offset or a
// dropped validity check is caught independently of parseDate itself.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serialFromParts } from "../../../../src/plugins/spreadsheet/engine/date-parser.ts";

describe("serialFromParts — valid triples map to the Excel serial", () => {
  it("March 4, 2025 is serial 45720", () => {
    assert.equal(serialFromParts(2025, 3, 4), 45720);
  });

  it("Jan 1, 1900 is serial 2 (Excel's Dec-30-1899 base with the 1900 leap-year quirk)", () => {
    assert.equal(serialFromParts(1900, 1, 1), 2);
  });

  it("accepts a real leap day (Feb 29, 2024)", () => {
    assert.equal(serialFromParts(2024, 2, 29), 45351);
  });

  it("accepts the upper year boundary (Dec 31, 2100)", () => {
    assert.equal(serialFromParts(2100, 12, 31), 73415);
  });
});

describe("serialFromParts — invalid triples are null", () => {
  it("rejects Feb 29 on a non-leap year", () => {
    assert.equal(serialFromParts(2025, 2, 29), null);
  });

  it("rejects a day past the month length (Feb 30)", () => {
    assert.equal(serialFromParts(2025, 2, 30), null);
  });

  it("rejects a month above 12", () => {
    assert.equal(serialFromParts(2025, 13, 1), null);
  });

  it("rejects a year below the 1900 floor", () => {
    assert.equal(serialFromParts(1800, 1, 1), null);
  });

  it("rejects a zero day", () => {
    assert.equal(serialFromParts(2025, 1, 0), null);
  });
});
