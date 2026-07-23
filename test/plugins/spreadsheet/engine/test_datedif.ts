// DATEDIF's per-unit elapsed-time math. Each unit has its own boundary handling
// — complete years/months back off when the day-of-month has not been reached,
// MD borrows the previous month's length, YD wraps into the end's year — and a
// wrong branch returns a plausible number rather than an error.
//
// Inputs are Excel serials, so tests build them from a known date via a helper
// rather than hardcoding the serial arithmetic (that is covered in
// test_dateUtils.ts).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDatedif } from "../../../../src/plugins/spreadsheet/engine/datedif.ts";
import { dateToSerial } from "../../../../src/plugins/spreadsheet/engine/date-utils.ts";

const serial = (year: number, month: number, day: number) => dateToSerial(new Date(Date.UTC(year, month - 1, day)));
const diff = (start: [number, number, number], end: [number, number, number], unit: string) => computeDatedif(serial(...start), serial(...end), unit);

describe("computeDatedif — Y (complete years)", () => {
  it("counts whole years between the same month and day", () => {
    assert.equal(diff([2020, 6, 15], [2023, 6, 15], "Y"), 3);
  });

  // The end has not yet reached the start's month/day in its year, so the last
  // year is incomplete.
  it("backs off a year when the anniversary has not been reached", () => {
    assert.equal(diff([2020, 6, 15], [2023, 6, 14], "Y"), 2);
    assert.equal(diff([2020, 6, 15], [2023, 5, 20], "Y"), 2);
  });

  it("counts the year once the anniversary is reached exactly", () => {
    assert.equal(diff([2020, 2, 29], [2024, 2, 29], "Y"), 4, "leap day to leap day");
  });
});

describe("computeDatedif — M (complete months)", () => {
  it("counts whole months", () => {
    assert.equal(diff([2023, 1, 10], [2023, 4, 10], "M"), 3);
    assert.equal(diff([2020, 1, 1], [2023, 1, 1], "M"), 36);
  });

  it("backs off a month when the day-of-month has not been reached", () => {
    assert.equal(diff([2023, 1, 15], [2023, 4, 10], "M"), 2);
  });
});

describe("computeDatedif — D (calendar days)", () => {
  it("counts the days between two dates", () => {
    assert.equal(diff([2023, 1, 1], [2023, 1, 31], "D"), 30);
    assert.equal(diff([2023, 1, 1], [2024, 1, 1], "D"), 365);
    assert.equal(diff([2024, 1, 1], [2025, 1, 1], "D"), 366, "leap year");
  });
});

describe("computeDatedif — MD (day-of-month diff, months ignored)", () => {
  it("subtracts the days directly when the end day is later", () => {
    assert.equal(diff([2023, 1, 10], [2023, 3, 25], "MD"), 15);
  });

  // When the end day is earlier, the code borrows the length of the month
  // BEFORE the end (Feb here) rather than the month before the start (Jan).
  // For Jan 30 → Mar 1 that gives `28 - 30 + 1 = -1` — a NEGATIVE day count,
  // which is wrong (Excel returns a positive number). Pinned as the current,
  // buggy behaviour so the extraction is faithful; the fix belongs with the
  // DATEDIF-boundary bug, not this refactor.
  it("returns the current (buggy) borrow result when the end day is earlier", () => {
    assert.equal(diff([2023, 1, 30], [2023, 3, 1], "MD"), -1, "borrows Feb's 28 days: 28 - 30 + 1");
    assert.equal(diff([2024, 1, 30], [2024, 3, 1], "MD"), 0, "borrows Feb's 29 days");
  });
});

describe("computeDatedif — YM (month diff, years ignored)", () => {
  it("counts months within the year", () => {
    assert.equal(diff([2020, 1, 10], [2023, 4, 10], "YM"), 3);
  });

  // Ignoring years can leave the month difference negative; it wraps into 0..11.
  it("wraps a negative month difference into the 0..11 range", () => {
    assert.equal(diff([2020, 11, 10], [2023, 2, 10], "YM"), 3);
  });

  it("backs off when the day has not been reached, then wraps", () => {
    assert.equal(diff([2020, 11, 20], [2023, 2, 10], "YM"), 2);
  });
});

describe("computeDatedif — YD (day diff, years ignored)", () => {
  it("counts days within the same year window", () => {
    assert.equal(diff([2023, 1, 1], [2023, 3, 1], "YD"), 59, "Jan + Feb 2023");
  });

  // Moving the start into the end's year would put it after the end, so it
  // steps back a year and counts across the boundary.
  it("crosses the year boundary when the start falls later in the end's year", () => {
    assert.equal(diff([2020, 12, 20], [2023, 1, 5], "YD"), 16, "Dec 20 to Jan 5");
  });
});

describe("computeDatedif — errors", () => {
  it("returns #NUM! when start is after end", () => {
    assert.equal(diff([2023, 6, 15], [2023, 6, 10], "D"), "#NUM!");
  });

  it("returns #NUM! for an unknown unit", () => {
    assert.equal(diff([2020, 1, 1], [2023, 1, 1], "Q"), "#NUM!");
    assert.equal(diff([2020, 1, 1], [2023, 1, 1], ""), "#NUM!");
  });

  it("matches the unit case-insensitively", () => {
    assert.equal(diff([2020, 1, 1], [2023, 1, 1], "y"), 3);
    assert.equal(diff([2023, 1, 1], [2023, 1, 31], "d"), 30);
  });

  it("returns 0 for identical dates in every unit", () => {
    for (const unit of ["Y", "M", "D", "MD", "YM", "YD"]) {
      assert.equal(diff([2023, 6, 15], [2023, 6, 15], unit), 0, `unit ${unit}`);
    }
  });
});
