# refactor(collection-plugin): CollectionView.vue remaining composables (#2528, part 2)

Finishes the **script → composables** half of #2528. The template/child slices
(Header/Table/Cell/Toolbar) and the `useCollectionActions` / `useFlagFilters` /
`useCollectionChat` composables already merged (#2527, #2532, and siblings).
`CollectionView.vue` is 1683 lines.

## The three composables the issue still lists

1. **`useViewMode`** — the view-mode state (table / calendar / kanban / custom):
   the `view` ref + init/restore + `activeView` collapse + `setView` /
   `setCustomView`. **EXTRACT.**
2. **`useLiveCollectionRefresh`** — the pub/sub live-refresh debounce with the
   edit-in-progress **defer** rule (a refresh landing mid-edit would clobber the
   user's draft). **EXTRACT** — defer semantics preserved byte-for-byte, pinned by
   pure tests.
3. **`useRecordPanelState`** — the `CollectionRecordPanel` open/close/selected
   state (`viewing` / `editing` / `saving` / `saveError` / `openDay`). **DEFER**
   (see below).

## Why `useRecordPanelState` is deferred (conservative, per issue guidance)

`viewing` and `editing` are the component's central refs. They thread through
**five** other consumers already wired to receive them as parent-owned refs —
`useCollectionActions({ viewing })`, `useCollectionChat({ viewing })`, the new
`useLiveCollectionRefresh({ editing })`, plus the template's `v-model:editing`
and ~20 script functions (`openView` / `showDetail` / `closeView` /
`openCreate` / `openEdit` / `cancelEditor` / `editFromView` / `saveEditor` /
`syncViewToSelected` / `commitInlineEdit` / `confirmDelete` / calendar +
kanban handlers …). A meaningful extraction would drag `loadCollection`,
`findItemById`, `render`, `generateUniqueItemId`, `emit`, `activeSelected` and
the whole load/save lifecycle into the composable — a god-composable, not a
cohesive slice. A thin refs-only container adds threading surface for near-zero
cohesion gain and risks a subtle reactivity regression in a **production core
feature**. The issue explicitly sanctions a 2-of-3 PR when one has unmovable
coupling; this is that one. It stays inline, and #2528 is **not** closed — a
follow-up note lists exactly what remains.

## Scope (SCRIPT-ONLY — template byte-identical)

Composables move `<script setup>` logic into `useXxx.ts`; the destructured names
return unchanged, so the template + every `data-testid` + the DOM stay
byte-identical. The template diff must be EMPTY.

## Pure decision logic (own file + unit tests, red-verified)

- `collectionViewMode.ts` (extend): `resolveActiveViewMode(view, hasCalendar,
  hasKanban, customViewIds)` — the stale-mode collapse (a `calendar`/`kanban`
  whose enabling field vanished, or an unknown `custom:<id>`, falls back to
  `table`); `builtInViewOrTable(mode)` — narrow a mode to a built-in.
- `liveRefresh.ts` (new): `LIVE_REFRESH_DEBOUNCE_MS`;
  `debouncedChangeAction(isEditing, activeSlug, firedSlug)` → `"defer"` while
  editing (**the guard**), else `"refresh"` only if still on the fired slug, else
  `"skip"`; `shouldFlushDeferredRefresh(editing, pending)` → flush only once the
  edit ends AND a change was deferred.

Tests: `test/plugins/collection/test_collectionViewMode.ts`,
`test/plugins/collection/test_liveRefresh.ts`. Each red-verified (invert the
defer branch / the collapse → the covering test goes red).

## Persistence note (consistency with the already-merged siblings)

`useTableSort` and `useFlagFilters` deliberately keep the localStorage **write**
in the parent's combined persist watch (which also emits `viewStateChange` and
writes sort + flag filters in one place). `useViewMode` follows that exact
pattern: it owns the ref + read-on-init + `resetForSlug` restore; the write stays
in the parent's combined watch. Splitting a second write watch out would add
inputs (`embedded` / `loading` / `collection`) and diverge from the siblings for
no behavioural gain.

## Gates

`yarn format` / `yarn lint` / `yarn typecheck` / `yarn build`; the collection
unit tests; and the collection mock e2e on a PRIVATE port
(`reuseExistingServer:false`) after rebuilding the plugin `dist/` (host serves
`dist`, not `src`) — with a sensitivity check (break a view-mode collapse or the
defer rule → spec RED after rebuild → restore). No version bumps.
