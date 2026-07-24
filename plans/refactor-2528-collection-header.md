# refactor(collection-plugin): extract CollectionHeader.vue (#2528)

Split from #2298. Extract the header region (template lines 3–188, the
`<header v-if="!hideHeader">…</header>` element) of
`packages/plugins/collection-plugin/src/vue/components/CollectionView.vue`
into a child `CollectionHeader.vue`. One focused PR, proven DOM-byte-equivalent.

## Named traps (from #2528 / #2298)

1. **Some header branches are referenced by NO e2e spec** — a regression there
   is unprovable by e2e alone, so for those branches safety is proven
   **structurally** (byte-identical markup + testid inventory diff vs
   origin/main).
2. **It drags `useRelatedMenu` across a component boundary.** A
   `useClickOutside` menu ref does NOT cross a boundary via props. Because the
   related-menu markup (wrapper `<div ref="relatedMenuRef">`, trigger, panel) is
   **entirely inside the header**, the fix is to move `useRelatedMenu` INTO
   `CollectionHeader.vue` — the ref, open-state and document listener then live
   in one component, exactly as before. This *eliminates* the cross-boundary
   risk rather than introducing it.

Favorable: the SFC has **no `<style scoped>`** — no scope-hash breakage.

## Design

- `CollectionHeader.vue` renders the `<header v-if="!hideHeader">` block
  verbatim. The `v-if="!hideHeader"` stays INSIDE the child so the child is
  always mounted (parent can always reach its exposed reset).
- Host couplings the child obtains itself (module singletons, callable in any
  component): `t` via `useCollectionI18n()`, `cui`/`pinToggle` via
  `collectionUi()`. Pure import `activatePathLink` from `../refLink`.
  `agentActionRunKey` from `@mulmoclaude/core/collection`.
- `useRelatedMenu` is instantiated INSIDE the child with
  `toRef(props,'collection')` / `toRef(props,'embedded')` + its own `cui`/`t`.
  `resetForSlugChange` is exposed via `defineExpose`; the parent calls it at the
  SAME `activeSlug`-watcher line it does today — **exact timing preserved**.
- `isActionRunning(action.id)` is re-derived locally in the child from a
  `runningActionIds: Set<string>` prop via the same pure `agentActionRunKey`
  (header only ever calls it with one arg → key `collection/<id>`).

### Props (read-only display state)

`collection`, `embedded`, `hideHeader`, `isReadOnly`, `dataSourceRoute`,
`isFeedRoute`, `refreshing`, `collectionActions`, `collectionActionPending`,
`runningActionIds`, `canCreate`, `calendarActive`, `canDeleteCollection`,
`canDeleteFeed`.

### Emits (props-in / emit-out, no function props)

`back`, `refreshFeed`, `openChat`, `runCollectionAction` (payload: action),
`openCreate`, `confirmCollectionDelete`, `confirmFeedDelete`.

## Per-branch verification table

Every top-level conditional branch in the header, its testid(s), and how it is
verified. "structural" = byte-identical markup + testid-inventory diff vs
origin/main (the only safety net for no-e2e-coverage branches).

| # | Branch (v-if / v-for) | testid(s) | e2e spec | Verification |
|---|---|---|---|---|
| 1 | `header v-if="!hideHeader"` | — | — | structural |
| 2 | back `button v-if="!embedded"` | `collections-back` | none | structural |
| 3 | icon `div v-if="collection"` | — | none | structural |
| 4 | title/slug block; `readonly` sub-branch `template v-if="isReadOnly"` | `collections-readonly-chip`, `collections-readonly-source` (`a v-if="dataSourceRoute"`) | none | structural |
| 5 | pin `component v-if="collection && !embedded"` | — | shortcut-bar (indirect) | structural |
| 6 | refresh-feed `button v-if="collection?.schema.ingest"` | `collections-refresh-feed` | none | structural |
| 7 | chat `button v-if="collection"` | `collections-chat` | collection-chat-button.spec.ts | e2e + structural |
| 8 | related-menu `div v-if="showRelatedMenu"` + panel + loading/empty/items | `collections-related-menu`, `-panel`, `-loading`, `-empty`, `-item-<slug>` | collection-related-menu.spec.ts | e2e + structural + sensitivity |
| 9 | collection actions `button v-for` | `collections-action-<id>` (computed) | none | structural |
| 10 | add `button v-if="canCreate && !calendarActive"` | `collections-add-item` | none | structural |
| 11 | delete-collection `button v-if="canDeleteCollection && !embedded"` | `collections-delete` | present-collection.spec.ts, collection-calendar.spec.ts | e2e + structural |
| 12 | delete-feed `button v-if="canDeleteFeed && !embedded"` | `feeds-delete` | none | structural |

## Proofs required before merge

- **Structural**: `data-testid` inventory of (CollectionView + CollectionHeader)
  on this branch == inventory of origin/main's CollectionView → empty diff.
  Header markup (lines 3–188) byte-identical after normalizing renamed
  handlers/state.
- **e2e**: collection mock e2e — `collection-related-menu.spec.ts` plus the
  covered header specs — on a PRIVATE port with `reuseExistingServer: false`,
  AFTER `yarn workspace @mulmoclaude/collection-plugin run build` (host serves
  plugin `dist/`, not `src/`). Pass.
- **Sensitivity**: break the related-menu wiring, rebuild the plugin, confirm
  `collection-related-menu.spec.ts` goes RED, restore.

## Gates

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, collection unit
tests, the three proofs above. No version bumps (extraction only).
