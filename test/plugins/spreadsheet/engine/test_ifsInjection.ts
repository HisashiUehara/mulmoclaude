// IFS reaching the condition evaluator rather than a JS engine.
//
// `test_condition.ts` covers the evaluator on its own; this file drives the
// whole path a user's data actually takes — a value typed into a cell, or text
// written into the formula — because that is what made #2360 reachable rather
// than theoretical.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

const marker = globalThis as Record<string, unknown>;

const calculate = (cellValue: string, formula: string): unknown =>
  new SpreadsheetEngine().calculate({ name: "S", data: [[{ v: cellValue }, { v: formula }]] } satisfies SheetData).data[0][1];

describe("IFS — normal use", () => {
  it("returns the first matching branch", () => {
    assert.equal(calculate("5", '=IFS(A1>3, "big", A1>0, "small")'), "big");
  });

  it("falls through to a later branch", () => {
    assert.equal(calculate("1", '=IFS(A1>3, "big", A1>0, "small")'), "small");
  });

  it("returns #N/A when no branch matches", () => {
    assert.equal(calculate("-1", '=IFS(A1>3, "big", A1>0, "small")'), "#N/A");
  });

  it("compares against text", () => {
    assert.equal(calculate("Yes", '=IFS(A1="Yes", "confirmed", A1="No", "declined")'), "confirmed");
    assert.equal(calculate("No", '=IFS(A1="Yes", "confirmed", A1="No", "declined")'), "declined");
  });

  // `IFS((A1>0), ...)` is ordinary usage; the parser used to split the
  // parenthesised form into two text operands that never matched.
  it("accepts a parenthesised condition", () => {
    assert.equal(calculate("5", '=IFS((A1>3), "big")'), "big");
    assert.equal(calculate("1", '=IFS((A1>3), "big", (A1>0), "small")'), "small");
    assert.equal(calculate("5", '=IFS(((A1>3)), "big")'), "big");
  });

  it("handles the boundary operators", () => {
    assert.equal(calculate("3", '=IFS(A1>=3, "atLeast3")'), "atLeast3");
    assert.equal(calculate("3", '=IFS(A1>3, "over3")'), "#N/A");
  });
});

describe("IFS — a cell's contents are data, not code", () => {
  // Typing this string into a cell used to execute it, because the cell value
  // was substituted into the condition and the result handed to `eval`.
  it("does not execute an assignment stored in a cell", () => {
    marker.__ifsProbe = false;
    calculate("globalThis.__ifsProbe=true", '=IFS(A1>0, "hit")');
    assert.equal(marker.__ifsProbe, false, "the cell's contents must not run");
  });

  it("does not execute a cell used as a bare condition", () => {
    marker.__ifsProbe2 = false;
    calculate("globalThis.__ifsProbe2=true", '=IFS(A1, "hit")');
    assert.equal(marker.__ifsProbe2, false);
  });

  // A payload starting with a digit was already neutralised by accident —
  // `getRawValue` reads its numeric prefix — so it is NOT evidence the hole is
  // closed. Pinned so nobody mistakes it for coverage.
  it("also refuses a payload whose numeric prefix used to mask it", () => {
    marker.__ifsProbe3 = false;
    calculate("1)||(globalThis.__ifsProbe3=true", '=IFS(A1>0, "hit")');
    assert.equal(marker.__ifsProbe3, false);
  });
});

describe("IFS — a text cell's operators are data, not syntax", () => {
  // A cell holding `x>y` used to substitute as bare `x>y`, so `A1="x>y"` became
  // `x>y="x>y"` and never matched. Quoting the operand fixes it (Codex review).
  it("compares against a cell whose text contains operators", () => {
    assert.equal(calculate("x>y", '=IFS(A1="x>y", "match", TRUE, "no")'), "match");
    assert.equal(calculate("x>y", '=IFS(A1="other", "match", TRUE, "no")'), "no");
  });

  it("treats a bare operator-bearing cell as truthy text, not a comparison", () => {
    assert.equal(calculate("x>y", '=IFS(A1, "truthy", TRUE, "no")'), "truthy");
    assert.equal(calculate("", '=IFS(A1, "truthy", TRUE, "empty")'), "empty");
  });

  // A cell holding a quote must not corrupt the comparison: `renderConditionOperand`
  // escapes it, and the condition parser tracks the escape.
  it("compares a quote-bearing cell without corrupting the parse", () => {
    assert.equal(calculate('a"b', '=IFS(A1="z", "match", TRUE, "no")'), "no", 'a"b is not z');
    assert.equal(calculate('a"b', '=IFS(A1, "truthy", TRUE, "no")'), "truthy", "still non-empty text");
  });
});

describe("IFS — operator characters inside a cell value stay data", () => {
  // A cell holding `x>y` renders into the condition as a quoted literal, and the
  // condition parser skips quoted regions when looking for the operator — so the
  // inner `>` is never read as a comparison (Codex review flagged this path).
  it("treats a bare reference to a string with an operator as truthy text", () => {
    assert.equal(calculate("x>y", '=IFS(A1, "hit")'), "hit");
  });

  it("compares equal against a string literal that contains an operator", () => {
    assert.equal(calculate("x>y", '=IFS(A1="x>y", "hit")'), "hit");
  });

  it("does not match when the operator-bearing strings differ", () => {
    assert.equal(calculate("x>y", '=IFS(A1="a>b", "hit")'), "#N/A");
  });
});

describe("IFS — absolute and mixed references resolve", () => {
  // The ref used to be escaped twice before the RegExp, so `$A$1` never matched
  // and was left as literal text in the condition (Codex review).
  it("substitutes an absolute reference", () => {
    assert.equal(calculate("5", '=IFS($A$1>0, "hit")'), "hit");
    assert.equal(calculate("5", '=IFS($A$1>10, "hit")'), "#N/A");
  });

  it("substitutes a mixed reference", () => {
    assert.equal(calculate("5", '=IFS(A$1>0, "hit")'), "hit");
    assert.equal(calculate("5", '=IFS($A1>0, "hit")'), "hit");
  });
});

describe("IFS — the formula itself is data too", () => {
  it("does not execute an expression written into the condition", () => {
    marker.__ifsProbe4 = false;
    calculate("1", '=IFS(A1>0&&(globalThis.__ifsProbe4=true), "hit")');
    assert.equal(marker.__ifsProbe4, false);
  });

  it("does not execute a call in the condition", () => {
    marker.__ifsProbe5 = false;
    calculate("1", '=IFS((globalThis.__ifsProbe5=true)>0, "hit")');
    assert.equal(marker.__ifsProbe5, false);
  });

  // A crash here would take the whole sheet's calculation with it. Broken
  // input degrades to the formula text — that is the engine's existing
  // swallow-everything behaviour (#2359), not something this change decides;
  // what matters here is that it neither throws nor runs.
  it("survives a syntactically broken condition", () => {
    marker.__ifsProbe6 = false;
    const result = calculate("1", '=IFS(((((globalThis.__ifsProbe6=true, "hit")');
    assert.equal(typeof result, "string");
    assert.equal(marker.__ifsProbe6, false);
  });
});
