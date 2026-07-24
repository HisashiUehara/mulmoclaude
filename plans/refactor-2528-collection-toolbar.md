# refactor(#2528): extract `CollectionToolbar.vue` from `CollectionView.vue`

Split from #2298 / #2528. One focused PR: pull the **search toolbar + filter
menu + view toggle** (template lines ~202–424) out of `CollectionView.vue`
into a child `CollectionToolbar.vue`, with byte-equivalent rendered DOM.

## Named trap (from #2528)

The toolbar carries **two click-outside refs** and a **v-model**:

- `filterMenuRef` / `filterMenuOpen` — the flag-filter dropdown (table view).
- `addMenuRef` / `addMenuOpen` — the "+" add-view target chooser.
- `searchQuery` — the record search input (`v-model`).

A `useClickOutside` ref does NOT cross a component boundary: the wrapper `<div>`
the composable watches (`menuRef`) must be a real element rendered by the same
component that owns the ref. So the extraction MUST **move each menu's
click-outside handling INTO the child** (open state + `menuRef` + the
`useClickOutside()` call all live where the wrapper `<div>` lives), not leave
the ref in the parent pointing at child DOM.

## Design

### Root wrapper stays byte-equivalent

`CollectionToolbar.vue`'s root element = the existing toolbar `<div class="px-6
py-3 bg-white border-b border-slate-100 flex items-center justify-between
gap-4">`. The **outer `v-if`** stays on the parent's `<CollectionToolbar>` tag
(so no wrapper appears/disappears differently). Everything inside the toolbar
`<div>` moves verbatim — same classes, same `data-testid`s (including the
dynamic `collection-view-custom-${cv.id}`, `collections-flag-chip-${chip.key}`,
etc., passed through as props / v-for items, never hardcoded).

### Click-outside (the trap) — moved fully into the child

The child calls `useClickOutside()` twice (`filterMenu*`, `addMenu*`),
identical to the parent today. `menuRef` binds the child's own wrapper `<div>`s,
so the document `mousedown` listener sees the child's live elements. The parent
stops owning these refs entirely.

Collection-switch reset: today the parent's `activeSlug` watch sets
`addMenuOpen.value = false; filterMenuOpen.value = false` when the slug changes.
Replicated inside the child with a `watch(() => props.collection?.slug, ...)`
that closes both menus — same observable behavior, closure intact.

### Search + flag filters — v-model (`defineModel`, Vue 3.5)

- `v-model:search-query` — parent keeps `searchQuery` (needed by
  `filteredItems`, the empty-state clear button); child binds the input and the
  clear "×".
- `v-model:flag-filters` — parent keeps `flagFilters` (needed by
  `tableFilteredItems`, `chipMatches`, the empty-state clear); child renders the
  chips and cycles them, emitting the new state.

`flagFilterMode(filters, key)` is extracted to a **pure helper**
(`collectionViewMode.ts`) so both parent (`tableFilteredItems`) and child (chip
display) read chip state through one own-property-safe function — no duplicate
of the `Object.hasOwn` guard (the `toString`-named-flag bug).

### Props (in) — derived state the parent already computes

`collection`, `items`, `hideSearch`, `hideViewToggle`, `activeView`,
`flagChips`, `customViews`, `canAddCustomView`, `canConfigureViews`,
`canAddMobileView`, `hasCalendar`, `hasKanban`, `hasCustomViews`,
`calendarActive`, `kanbanActive`, `dateFields`, `enumFields`,
`calendarAnchorField`, `kanbanGroupField`, `tableFilteredCount`,
`filteredCount`.

`FlagChip` type moves to `collectionViewMode.ts` (shared by parent + child).

### Emits (out) — actions (never function props)

`set-view`, `set-custom-view`, `add-view` (target), `open-config`,
`update:anchor-field`, `update:group-field` (+ the two `update:` model events).
The chat-seed (`addCustomView`) and axis overrides (`anchorOverride`,
`kanbanOverride`) stay in the parent; the child only signals intent.

Chip presentation/cycle helpers (`flagChipClass`, `flagChipTitle`,
`flagChipIcon`, `flagChipIconClass`, `cycleFlagFilter`, `activeFlagFilterCount`)
and the add-menu mechanics (`onAddViewClick`) move into the child.

## Gates

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, collection unit
tests, and the collection mock e2e (esp. `collection-flag-filter`,
`collection-add-view-menu`, `present-collection`).

E2E discipline: build the plugin `dist/` before trusting a green e2e (host
serves `dist/`, not `src/`); run against a private port with
`reuseExistingServer:false`. Sensitivity check: break a toolbar `data-testid`,
confirm the relevant spec goes RED after rebuild, restore.

Both menus' outside-click proven by e2e: the add menu by
`collection-add-view-menu.spec.ts` (already asserts outside-click dismiss); a
new assertion added to `collection-flag-filter.spec.ts` proves the filter menu
dismisses on outside-click too.

## Byte-equivalence verification

Diff the toolbar markup in `origin/main`'s `CollectionView.vue` against
`CollectionToolbar.vue` (normalizing only renamed handlers/state) — must be
identical; `data-testid` inventory of the touched region unchanged.
