// Domain and boundary rules for the math functions. The bugs here returned a
// plausible NUMBER (FLOOR(-2.5,2) = -4, ROUND(-2.5,0) = -2, MOD(-3,2) = -1) or a
// silent NaN/∞ instead of an Excel error (#2389). The rounding direction, the
// modulo sign and the domain guards are checked directly on the pure helpers,
// with a few end-to-end checks that the handlers surface the error strings.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  roundTo,
  roundUpTo,
  roundDownTo,
  floorToSignificance,
  ceilingToSignificance,
  modulo,
  power,
  safeLog,
  safeLog10,
  safeSqrt,
} from "../../../../src/plugins/spreadsheet/engine/math-ops.ts";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

const closeTo = (actual: number, expected: number, eps = 1e-9): boolean => Math.abs(actual - expected) <= eps;

describe("roundTo / roundUpTo / roundDownTo — direction", () => {
  it("rounds half away from zero, not toward +infinity", () => {
    assert.equal(roundTo(-2.5, 0), -3);
    assert.equal(roundTo(2.5, 0), 3);
    assert.ok(closeTo(roundTo(0.125, 2), 0.13));
  });

  it("rounds up away from zero", () => {
    assert.ok(closeTo(roundUpTo(-3.14159, 2), -3.15));
    assert.ok(closeTo(roundUpTo(3.14159, 2), 3.15));
  });

  it("rounds down toward zero", () => {
    assert.ok(closeTo(roundDownTo(-3.14159, 2), -3.14));
    assert.ok(closeTo(roundDownTo(3.19, 1), 3.1));
  });
});

describe("floorToSignificance / ceilingToSignificance — sign domain", () => {
  it("is #NUM! when number and significance disagree in sign", () => {
    assert.equal(floorToSignificance(-2.5, 2), "#NUM!");
    assert.equal(ceilingToSignificance(2.5, -2), "#NUM!");
  });

  it("rounds to the multiple when the signs match", () => {
    assert.equal(floorToSignificance(2.5, 2), 2);
    assert.equal(floorToSignificance(-2.5, -2), -2);
    assert.equal(ceilingToSignificance(2.5, 2), 4);
    assert.equal(ceilingToSignificance(-2.5, -2), -4);
  });

  it("returns 0 for a zero significance and for a zero value", () => {
    assert.equal(floorToSignificance(5, 0), 0);
    assert.equal(ceilingToSignificance(0, 2), 0);
  });
});

describe("modulo — divisor sign and division by zero", () => {
  it("takes the sign of the divisor", () => {
    assert.equal(modulo(-3, 2), 1);
    assert.equal(modulo(3, -2), -1);
    assert.equal(modulo(-3, -2), -1);
    assert.equal(modulo(5, 3), 2);
  });

  it("is #DIV/0! when the divisor is zero", () => {
    assert.equal(modulo(5, 0), "#DIV/0!");
  });
});

describe("power — negative base domain", () => {
  it("is #NUM! for a negative base with a non-integer exponent", () => {
    assert.equal(power(-8, 1 / 3), "#NUM!");
    assert.equal(power(-2, 0.5), "#NUM!");
  });

  it("computes when the exponent is an integer or the base is non-negative", () => {
    assert.equal(power(-2, 3), -8);
    assert.equal(power(2, 10), 1024);
    assert.ok(closeTo(power(9, 0.5) as number, 3));
  });
});

describe("safeSqrt / safeLog / safeLog10 — domain", () => {
  it("is #NUM! outside the domain", () => {
    assert.equal(safeSqrt(-1), "#NUM!");
    assert.equal(safeLog(0), "#NUM!");
    assert.equal(safeLog(-1), "#NUM!");
    assert.equal(safeLog10(0), "#NUM!");
  });

  it("computes inside the domain", () => {
    assert.equal(safeSqrt(4), 2);
    assert.ok(closeTo(safeLog(Math.E) as number, 1));
    assert.equal(safeLog10(1000), 3);
  });
});

describe("the handlers surface the errors end-to-end", () => {
  const evalFormula = (formula: string): unknown => new SpreadsheetEngine().calculate({ name: "S", data: [[{ v: formula }]] } satisfies SheetData).data[0][0];

  it("returns the Excel error strings through the engine", () => {
    assert.equal(evalFormula("=FLOOR(-2.5, 2)"), "#NUM!");
    assert.equal(evalFormula("=SQRT(-1)"), "#NUM!");
    assert.equal(evalFormula("=MOD(5, 0)"), "#DIV/0!");
    assert.equal(evalFormula("=ROUND(-2.5, 0)"), -3);
    assert.equal(evalFormula("=MOD(-3, 2)"), 1);
  });
});
