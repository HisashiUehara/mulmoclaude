# refactor(#2528): extract CollectionTable.vue + CollectionCell.vue from CollectionView.vue

## Goal

Split the list-table markup out of `CollectionView.vue` (~2629 lines) into two
child components, proving the rendered DOM is **byte-equivalent**. This is the
highest-risk slice of #2528 / #2298 because:

1. `collections-row-<id>` (6 e2e specs) MUST stay on the root `<tr>`.
2. `collection-image-field.spec.ts:71` traverses `thead th` — the
   `<table><thead>…<th></thead><tbody>…</tbody></table>` shape must not gain or
   lose a node.
3. All `data-testid`s across the region must stay identical.

Favourable: the SFC has **no `<style scoped>`**, so no scope-hash breakage.

## Decomposition

- **`CollectionCell.vue`** — template root IS the `<td class="px-5 py-2 …">`.
  Contains every field-type branch (toggle/bool/flag/ref/enum/money/table/derived/
  rollup/url/file/plain). No wrapper node.
- **`CollectionTable.vue`** — template root IS the `<table class="min-w-full text-xs">`.
  Contains `<thead>` (th + sort), `<tbody>` with the `<template v-for>`/`<tr>` loop;
  each `<td>` becomes `<CollectionCell>`. No wrapper node.

Single-root-element children ⇒ Vue emits no wrapper ⇒ `<tr>`/`<td>`/`<table>`
nesting is preserved.

## Prop / emit contracts (props in, emit out — no function props)

Established pattern (mirrors `CollectionRecordPanel.vue`): child receives the
`render: CollectionRendering` service as a prop, calls `collectionUi()` and
`useCollectionI18n()` itself, and imports pure helpers directly
(`fieldVisible`, `toggleChecked`, `isSortableField`, `rowIdOf`, `cellKey`,
`resolveEnumColor`, `flagFieldValue` from core; `activateRefLink`/`activatePathLink`
from `../refLink`; `previewSortDir`/`sort*ForDir` from `../tableSortDisplay`).

### CollectionCell.vue
- props: `field`, `item`, `fieldKey`, `collection`, `render`, `isReadOnly`,
  `rowInlineSaving`, `enumOriginallyEmpty`
- emits: `commitToggle(item, field)`, `commitInlineEdit(item, key, field, raw)`
- local (identical logic): `flagValueOf`, `showEnumPlaceholder`, `enumControlClass`,
  `tableSummary`
- `($event.target as HTMLInputElement)` casts → `instanceof` type-guard methods
  (no-`as` rule; DOM output unchanged)

### CollectionTable.vue
- props: `collection`, `listColumnFields`, `sortedItems`, `render`, `isReadOnly`,
  `enumOriginallyEmpty`, `inlineSavingRows`, `sortState`, `openRowId`, `editingRowId`
- `v-model:hoveredSortKey`
- emits: `openView(item)`, `cycleSort(key)`, `commitToggle`, `commitInlineEdit`,
  `update:hoveredSortKey`
- re-derives per-column sort display from `sortState` + `hoveredSortKey` via the
  pure `../tableSortDisplay` fns (same output as `useTableSort`).

## Parent changes (CollectionView.vue)

- Replace `<table>…</table>` (603–796) with `<CollectionTable …>`.
- Remove now-unused: fns `showEnumPlaceholder`, `enumControlClass`, `isEditingRow`,
  `tableSummary`, `isRowInlineSaving`; imports `fieldVisible`, `cellKey`,
  `resolveEnumColor`, `activateRefLink`; useTableSort destructure entries
  `sortIconName`, `sortButtonClass`, `sortAriaValue`.
- Add computeds `openRowId` (= rowId(viewing)) and `editingRowId`
  (= non-create draft.originalId), replacing the `isRowOpen||isEditingRow` row class.
- Keep everything still referenced elsewhere: `isRowOpen` (openView), `flagValueOf`
  (sortValueDeps), `toggleChecked`/`refDisplay`/`evaluateDerivedAgainstItem`
  (sortValueDeps), `cycleSort`/`hoveredSortKey`/`sortState`/`sortedItems` (props),
  `activatePathLink` (dataSource route, line 41).

## Staged commits (ship the proven subset)

1. `docs(plan)` — this file.
2. Extract `CollectionCell.vue`; prove testid diff + build + collection unit +
   e2e subset + sensitivity.
3. Extract `CollectionTable.vue`; prove full `<table>` byte-diff + e2e + sensitivity.

If the Table proof is not rock-solid, DROP commit 3 and PR Cell-only (Table
deferred with evidence) — the `<table>/<thead>/<tr>` stay untouched in the parent,
so traps 1 & 2 hold by non-modification.

## Three proofs (all required before merge)

1. **Structural** — sort+diff every `data-testid` template string:
   `origin/main` CollectionView vs (View + CollectionTable + CollectionCell),
   normalizing `${fieldKey}`→`${key}`. Empty diff. Plus a normalized
   `<table>…</table>` markup diff (nesting identical).
2. **e2e** — collection mock e2e on a PRIVATE port (`reuseExistingServer:false`)
   AFTER `yarn workspace @mulmoclaude/collection-plugin run build`. Must include
   `collection-image-field.spec.ts` + the 6 `collections-row-<id>` specs. All green.
3. **Sensitivity** — move `collections-row-<id>` onto a wrapper (or drop a `<th>`),
   rebuild, confirm the relevant spec goes RED, restore.

Do NOT merge unless all three are rock-solid.
