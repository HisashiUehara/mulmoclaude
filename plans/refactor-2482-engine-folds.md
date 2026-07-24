# refactor(spreadsheet): fold duplicated engine helpers (#2482)

Behaviour-preserving de-duplication of the spreadsheet engine clones catalogued
in #2482. The engine directory is excluded from the duplication scan, so these
clones never surface in Code Scanning; #2482 records them so they don't get lost.

Base: `origin/main` @ `bcd91c26b`. No open PR touches
`src/plugins/spreadsheet/engine/` (checked `gh pr list --state open`), so no fold
overlaps active parallel work. Matched every site by function name, not line
number, against current main.

## Per-candidate result

| # | Candidate | Status | Helper | Sites folded |
|---|-----------|--------|--------|--------------|
| 1 | date-parser | DONE | `serialFromParts(year, month, day)` | 5 branches of `parseDate` (ISO, DD-MMM-YYYY, MMM D YYYY, D MMM YYYY, slash) |
| 2 | formatter thousands grouping | ALREADY DONE | `groupThousands` (pre-existing, #2510) | both currency + comma branches already call it — nothing to do |
| 3 | financial IPMT/PPMT handlers | DONE | `makePeriodicComponentHandler(compute)` factory | `ipmtHandler`, `ppmtHandler` in `functions/financial.ts` |
| 4 | calculator cross-sheet resolve | DONE | `resolveSheetData(ref): ResolvedSheetRef \| null` | `getCellValue`, `collectRangeValues` |
| 5 | text FIND/SEARCH | DONE | `locateSubstring(find, within, start, {caseInsensitive})` | `findHandler`, `searchHandler` in `functions/text.ts` |

Nothing skipped for drift — all five sites still matched the issue's description on
current main.

### 1. date-parser — `serialFromParts`
Every dated branch ended in the same `isValidDate -> Date.UTC(year, month-1, day)
-> dateToSerial` tail (two clone shapes: bare, and month-name-guarded). Extracted
`serialFromParts` returning `number | null`; the three month-name branches keep
their own `parseMonthName` + `if (month === null) return null` (equivalent to the
old `if (month && ...)` since month is 1-12, never 0).

### 2. formatter — already folded
`groupThousands` already exists (added by the TEXT-format PR #2510) and BOTH the
`$` currency branch and the bare-comma branch already route through it. No second
helper added.

### 3. financial — `makePeriodicComponentHandler`
`ipmtHandler` and `ppmtHandler` were byte-identical except the final
`computeIpmt` / `computePpmt` call. A factory captures the shared six-operand
parse (incl. the optional `fv` / `type` defaults) so the two can't drift.
FV/PV/PMT/NPER/RATE left as-is (issue: don't over-abstract; the clear win is
IPMT/PPMT).

### 4. calculator — `resolveSheetData` (two-stage cache seed preserved EXACTLY)
`getCellValue` and `collectRangeValues` shared: sheet-ref regex match -> cache
check -> **two-stage cache seed (infinite-loop guard)** -> `calculateSheet`.
`resolveSheetData` returns `{ sheetData, ref, isCurrentSheet } | null`; null means
the named sheet doesn't exist, and each caller keeps its terminal action
(`getCellValue` throws #REF!, `collectRangeValues` returns []). The two-stage seed
(raw copy published to the cache BEFORE recursing, real result after) is copied
verbatim. `.has()/.get()!` became `const cached = get(); if (cached)` — equivalent
because cache values are always arrays (never falsy), and it drops the `!`
non-null assertion. Kept as a closure (not a standalone pure fn) because it
depends on `calculateSheet` recursion + the per-call cache; covered by the
cross-sheet integration + cyclic tests.

### 5. text — `locateSubstring`
FIND (case-sensitive) and SEARCH (case-insensitive) shared start calc, #VALUE!
miss, 1-based return; differed only in case folding. `locateSubstring` takes a
`{caseInsensitive}` flag; each handler keeps its own arg resolution.

## Not touched (見送り — intentionally kept duplicated, per #2482)
- condition.ts / evaluator.ts / jsonCellLocator.ts quote scanners — 3 different
  escape rules; a unified scanner hurts readability.
- formatter <-> text.ts `$`/decimal branches — deliberately different output
  (`TEXT(1000,"$")` -> `$1000.00` vs formatCell -> `$1000`).

## Tests
- Full engine suite: 829 -> 855 (+26), all pass after every fold.
- New pure-helper tests: `test_serialFromParts.ts` (9), `test_locateSubstring.ts` (8).
- New engine-level financial handler test: `test_financialPeriodicHandlers.ts` (4)
  — drives IPMT/PPMT through the engine (the layer the factory lives in), since
  the existing `test_financialMath.ts` only covers the pure math.
- `test_crossSheetReference.ts` extended: 2- and 3-sheet cycles terminate with
  `#ERROR!` (don't hang), valid cross-sheet still resolves `[10,30]`, missing-sheet
  keeps per-caller terminal (#REF! for a cell, empty range for SUM).

## Mutation checks (broke helper, saw red, restored)
- calculator: `resolveSheetData` returning `ref: fullRef` -> 8/11 cross-sheet tests fail.
- financial: factory ignoring `type` -> begin-of-period IPMT test fails (-1250 vs 0).
- date-parser: wrong month offset -> 4 serialFromParts tests fail.
- text: never case-fold -> 2 locateSubstring tests fail.

## Verification
- Cyclic cross-sheet baseline (before + after fold 4): `#ERROR!` in ~10ms, valid `[10,30]` — identical.
- `npx tsc --noEmit` (src) clean; full `yarn typecheck` (incl. test/) clean.
