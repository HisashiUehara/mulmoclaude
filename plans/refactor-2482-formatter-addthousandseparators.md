# refactor(spreadsheet): fold the formatter thousand-separator wrapper (#2482)

Follow-up to #2529, which folded the other four #2482 engine candidates
(`serialFromParts`, `makePeriodicComponentHandler`, `resolveSheetData`,
`locateSubstring`). #2529 recorded candidate 2 (formatter grouping) as "already
done via `groupThousands` (#2510)" — but that only extracted the inner digit
loop. The 3-line **wrapper** around it was still copied in two branches of
`formatNumber`:

```ts
const parts = formatted.split(".");
parts[0] = groupThousands(parts[0]);
formatted = parts.join(".");
```

— once inside the `$`-with-comma branch and once in the plain-comma branch.
`addThousandSeparators` is exactly the helper #2482 candidate 2 named.

## Change

- **formatter.ts** — add `addThousandSeparators(formatted)` (group the integer
  part, leave the fraction alone) beside `groupThousands`. Both branches call
  it; the surrounding `let formatted` reassignment chains become `const` (the
  currency branch inlines its one-shot `hasComma`, the comma branch collapses to
  one expression). Output is byte-identical:
  - currency: `magnitude → (comma ? group : magnitude) → "$"+ → sign` unchanged.
  - comma: `group(magnitude) → sign` unchanged.

The engine is excluded from the duplication scan, so this clone never surfaced
as an alert; the tests are the only safety net.

## Tests

`test_formatter.ts` gains an `addThousandSeparators` block (grouping, fraction
preserved, short/empty pass-through). The existing currency / comma / plain
`formatNumber` assertions pin the end-to-end output unchanged. Full engine suite
green.

## Not in this PR

Candidates 1/3/4/5 and the intentionally-kept 見送り duplicates are already
handled by #2529 (merged) — untouched here.
