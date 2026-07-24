# fix(spreadsheet): RATE / IRR report #NUM! on non-convergence — #2360 (final)

## Problem

`computeRate` and `computeIrr` (`engine/financial-math.ts`) solve their equations
with Newton-Raphson. On a series with no real solution the iteration never
converges — but the code fell out of the loop and returned the **last iterate**:
a divergent finite number or `NaN`, handed back as if it were a valid rate. Excel
reports `#NUM!` there. `computeIrr` additionally `throw`w `new Error("IRR cannot
converge")` on a flat derivative, which after #2492 (errors are values) is
inconsistent with the rest of the engine.

This is the last unfixed row of the #2360 mismatch table.

## Fix

Both functions now return `number | SpreadsheetError` and yield `NUM_ERROR`
(`#NUM!`) when:
- the loop exhausts `NEWTON_MAX_ITERATIONS`, or
- a converged step is non-finite, or
- (IRR) the derivative collapses — replacing the `throw`.

The two handlers in `functions/financial.ts` already return the helper's result
directly, so the error value propagates as a cell value like every other
function's `#NUM!`/`#DIV/0!`.

## Tests

`test_financialMath.ts` — two pre-existing tests **deliberately pinned the old
Excel-divergent behaviour** (their comments said "pinned so a future change is a
conscious decision"); this is that conscious change, so they were rewritten to
assert `#NUM!`:
- RATE with no root → `NUM_ERROR`
- IRR on same-sign flows → `NUM_ERROR`

The convergent cases are unchanged (a `converged()` type-guard narrows the union
for the numeric assertions — no `as` cast).

**Mutation-verified**: reverting both non-convergence returns to the old
`return rate` / `throw` turns exactly those two tests red (`pass 24 / fail 2`),
green after restore.

## #2360 coverage (all rows now addressed)

| Row | PR |
|---|---|
| IF nested function | #2474 |
| IFERROR | #2492 (error value type) |
| HLOOKUP/VLOOKUP 4th arg, out-of-range | #2453, #2506 |
| STDEV/VAR sample | #2453 |
| MOD, ROUND(UP/DOWN), ROUND negative | #2432, #2501 |
| NPV period offset | #2441 |
| RATE/IRR non-convergence | **this PR** |
| IFS eval | #2362 |
| MID bounds, VALUE | #2503 |
| COUNTIF/SUMIF criteria, coercion | #2485, #2502 |
| TEXT digit grouping | #2510 |
