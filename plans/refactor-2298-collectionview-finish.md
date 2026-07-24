# refactor(#2298): CollectionView.vue — finish (remaining pure helpers + tests)

Fourth and final step on #2298. `CollectionView.vue` is the repo's largest SFC
and the highest e2e-breakage risk in the split campaign. Three earlier PRs did
the bulk of the split; this PR closes the remaining **pure-function extraction +
test-coverage** gaps the issue lists, using the safest possible layer (no
template edits at all).

## What the three earlier PRs already did (verified against `origin/main`)

- **#2384** (`7c56a4d38`) — pure helpers + **click-outside dedup**. Extracted
  `sortValueOf` / `textSearch` / `completion` (`itemIsDone`,
  `completionCoveredByFieldChip`) / core `recordKeys` (`cellKey`,
  `snapshotEmptyEnums`) / core `ids` (`generateUniqueId`); replaced the 3
  copy-pasted click-outside menus (`filterMenu` / `relatedMenu` / `addMenu`)
  with the single plugin-local `composables/useClickOutside.ts`; added the
  `docs/shared-utils.md` Known-duplicates entry for the deliberate host/plugin
  `useClickOutside` split. **→ the dedup task is already complete.**
- **#2455** (`c8734f9c4`) — `useRelatedMenu` / `useTableSort` composables (with
  `storedSortFor` moving into `useTableSort`), template byte-identical.
- **#2476** (`60a42f82b`) — `CollectionChatModal.vue` + `CollectionRepairBanner.vue`
  child components. All 51 testids preserved; collection mock e2e 73/73 == 73/73.

## Done in THIS PR — pure functions still inline, now extracted to core + tested

Template is **byte-for-byte identical** (diff confined to `<script setup>`); each
extracted function is imported and the component delegates, so zero DOM changes.

| Extracted | To | Component now |
|---|---|---|
| `rowIdOf(primaryKey, item)` | `core/recordKeys.ts` | `rowId(item)` delegates |
| `flagFieldValue(record, key)` | `core/completion.ts` | `flagValueOf` delegates |
| `toggleChecked(item, field)` | `core/completion.ts` | imported (was local); template/commitToggle/sortDeps unchanged |
| `chipMatches(chip, schema, item, deriveRecord)` + `FlagChip` type | `core/completion.ts` | `tableFilteredItems` call site delegates; local copy + `FlagChip` interface removed |
| `nextUniqueItemId(items, primaryKey, generate, maxAttempts?)` | `core/ids.ts` | `generateUniqueItemId` delegates |
| `skillCommandSeed(slug, message, itemId?)` | new `core/chatSeed.ts` | `buildChatSeed`'s non-feed branch delegates |

Tests (all import via the package name `@mulmoclaude/core/collection` so they
exercise the built dist, per the monorepo rule):

- `test/utils/collections/test_recordKeys.ts` — `rowIdOf` (scalar, missing→"",
  no-primaryKey, cellKey composition). Mutation-checked: reverting the `?? ""`
  guard turns the "missing → empty" case red.
- `test/utils/collections/test_completion.ts` — `toggleChecked`, `flagFieldValue`
  (strict `=== true`), `chipMatches` (synthetic / toggle / boolean / flag dispatch,
  flag branch reading the enriched record).
- `test/utils/collections/test_ids.ts` — `nextUniqueItemId` (existing-set build,
  collision re-roll, other-key isolation, missing-key→"" collision, empty list).
- `test/utils/collections/test_chatSeed.ts` (new) — `skillCommandSeed` wire format
  (with / without `id=` selector).

`docs/shared-utils.md`: extended the `ids.ts` row (added `generateUniqueId` /
`nextUniqueItemId`) and added rows for `completion.ts`, `recordKeys.ts`, and the
new `chatSeed.ts` (these files were previously uncatalogued).

### One deliberate behavior alignment (String → fieldText)

`rowIdOf` / `nextUniqueItemId` / `toggleChecked` originally used
`String(item[key] ?? "")`. In the eslint-ignored `.vue` that passed; in linted
`packages/` it trips `@typescript-eslint/no-base-to-string` (the "[object Object]"
trap the rule exists to catch). Switched to the codebase's sanctioned reader
`fieldText` — **behavior-identical for any scalar primary key / enum value**
(the only real cases), and it makes `rowIdOf` use the exact same derivation as
`snapshotEmptyEnums`, so `cellKey(rowIdOf(...), field)` and the empty-enum
snapshot are now provably consistent (they only agreed by coincidence before).

## `buildChatSeed` dedup check (issue asked to check first)

`presentCollection.ts` has **no** chat-seed / slash-command builder — it is only
the tool definition + a pure echo executor. So there was no duplicate to fold
into; only the pure skill-command sliver (`skillCommandSeed`) was extracted. The
feed branch stays in the view (it is `t()` / `collection.value`-driven).

## Deferred (unchanged from #2455 / #2476 — each hits a real trap)

Template → child components and the heavier stateful composables. These are
**NOT closed by this PR** and remain the honest remaining scope:

- **CollectionHeader.vue** — its conditional branches
  (`collections-refresh-feed`, `collections-delete`, `feeds-delete`,
  `collections-action-<id>`, `collections-readonly-*`) are referenced by **no
  e2e spec**, so a ~13-prop/~7-emit rewiring can only be reviewed, not proved;
  it would also drag `useRelatedMenu` into the child (a `ref` used by
  `useClickOutside` cannot cross a component boundary).
- **CollectionToolbar.vue** — the same click-outside-ref problem twice
  (`filterMenuRef` **and** `addMenuRef`) plus the `v-model="searchQuery"`.
- **CollectionTable.vue + CollectionCell.vue** — highest risk in the repo: the
  `<table>/<thead>/<th>` hierarchy `collection-image-field.spec.ts:71`
  traverses, and `collections-row-<id>` (6 specs) which must stay on the root
  `<tr>`. Deserves a dedicated byte-equivalence PR.
- Stateful composables: `useViewMode`, `useCollectionActions`, `useFlagFilters`,
  `useLiveCollectionRefresh`, `useRecordPanelState`, `useCollectionChat`.

## e2e / testid safety

The diff is entirely inside `<script setup>` (first hunk at line 894; the
`<template>` block is lines 1–857). Therefore **every 維持必須 testid is
preserved on the same element type, unmoved**, and the two structural traps hold
by construction:

- `collections-row-<id>` is on the root `<tr>` (opens line 633,
  `:data-testid` at line 639) — untouched. It is interpolated directly from
  `item[collection.schema.primaryKey]` in the template, independent of the
  `rowId()` helper, so the refactor cannot shift it.
- The `<table>` (603) / `<thead>` (604) / `<th>` header row (605) hierarchy is
  untouched.

Full 維持必須 list, all preserved: `collections-chat*`, `collections-related-menu*`,
`collections-add-item`, `collections-filter-menu`, `collections-flag-chip-<key>`,
`collection-view-toggle-*`, `collection-view-custom-<id>`, `collections-inline-*`,
`collections-sort-<key>`, `collections-row-<id>`, `collections-url-link-*`.

## Verification

- `test/utils/collections/*.ts` 309/309, `packages/core/test/**` 577/577.
- `yarn typecheck` clean (incl. vue-tsc on the plugin), `yarn lint` 0 errors,
  `yarn build:packages` succeeds.
- e2e: **not run** (mock e2e needs a per-worktree dev server on a private port;
  a shared-port run would misattribute across worktrees). Safety is instead
  guaranteed by the byte-identical `<template>` (verified by diff) — a stronger
  guarantee than a run for a no-DOM change.

## Is #2298 closable?

**Not fully.** The pure-function + dedup + test gaps the issue lists are now
closed, but the template → child-component splits (Header / Toolbar / Table+Cell)
and the heavier composables remain deferred with concrete traps. This PR is
`Refs #2298`, not `Fixes #2298`.
