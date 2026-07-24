# refactor(#2528): CollectionView.vue script → composables (slice 1)

Issue #2528 (split from #2298) covers the remaining `CollectionView.vue` extraction: the
template → child-component splits (`CollectionTable`/`CollectionCell`, `CollectionToolbar`,
`CollectionHeader`) **and** the heavier stateful composables. This PR does the **script →
composables** half, and only a coherent, individually-verifiable subset of it — one PR, the
rest deferred with reasons below.

## Why the script half is the safe half

Composables are **script-only**. The template + every `data-testid` + the rendered DOM stay
**byte-identical**: `<script setup>` logic moves into `useXxx.ts` files and the same names are
destructured back into top-level scope, so the template's bindings are unchanged. The extraction
is verified by an **empty template diff** (`git diff` restricted to lines 1–856) plus the
collection unit + mock-e2e suites.

`CollectionView.vue` has **no `<style scoped>`** (verified), so there is no CSS surface to move.

## This PR extracts (3 composables + 2 pure-logic units)

- **`useCollectionActions`** — the agent/mutate/collection action cluster, owning the
  `runningActions` **generation guard**. The guard's stale-drop semantics (a detail response that
  started before a local mutation must not clobber the optimistic key — Codex/CodeRabbit on #2104)
  are preserved exactly and extracted into a standalone, unit-tested factory
  `runningActionsGuard.ts` (`createRunningActionsGuard`). The composable re-exposes just
  `clearRunningActions()` + `beginRunningActionsReconcile()` for the two load-path call sites
  (`loadCollection` / `refreshItemsInPlace`) that stay in the component.
- **`useFlagFilters`** — the tri-state flag-filter chips (all → hide → only), their per-collection
  localStorage state, and the filter-menu click-outside. The pure decision logic — the tri-state
  transition, the **own-property** mode read (a field named `toString` must not read the inherited
  function — Codex #2176), the state-rebuild-on-cycle, and the icon/class mappings — moves into
  `flagFilterDisplay.ts` (mirroring the existing `tableSortDisplay.ts`) and is unit-tested.
- **`useCollectionChat`** — the chat modal open/close + the skill/feed chat-seed builder
  (`submitChat` / `onItemChat`). The seed's skill-vs-feed decision already lives in core
  (`skillCommandSeed`), so no new pure file is warranted here.

## Deferred (with reasons)

- **`useViewMode`** (view mode + calendar/kanban axis fields + custom views) — the largest cluster
  and the most entangled with the switch-collection reset watch (`view`/`anchorOverride`/
  `kanbanOverride`) and the persist watch (`activeView`/`calendarAnchorField`/`kanbanGroupField`).
  Worth its own focused PR.
- **`useLiveCollectionRefresh`** (debounce + edit-in-progress defer) — self-contained but timer-
  based; deserves a dedicated PR with fake-timer tests for the debounce-collapse + defer-past-edit
  rules.
- **`useRecordPanelState`** (viewing/editing/openDay + open/edit/save/delete flows) — the biggest
  and most load-path-coupled cluster (`loadCollection`, `emit("select")`, deep-link sync). Highest
  review cost; last.
- All **template → child-component** splits from #2528 (`CollectionTable`/`CollectionCell`,
  `CollectionToolbar`, `CollectionHeader`) — each carries a DOM byte-equivalence trap and belongs
  in its own PR.

## Gates

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`; the collection unit tests
(`test/utils/collections/*`, `test/plugins/collection/*`, `test/plugins/test_applicableViewModes.ts`)
including the two new pure-logic tests, **red-verified**; and the collection mock e2e
(`e2e/tests/collection-*.spec.ts`) on a **private port** with `reuseExistingServer: false` **after a
real plugin `dist` rebuild** — with a sensitivity check that breaking the flag-filter wiring turns
`collection-flag-filter.spec.ts` red.

No version bumps (deferred to the next publish, per repo convention).
