# feat(shortcuts): reorder pinned launcher shortcuts (#2519)

Status: implemented (branch `feat/2519-reorder-shortcuts`, from `origin/main` @ `f518c7ae7`)

## Problem (#2519)

Pinned collection / feed shortcuts render in Group 2 of the launcher in
**pin (append) order only** — `pin()` appends to the tail
(`useShortcuts.ts`), and there is no way for the user to change the
order. As pins accumulate, related shortcuts drift apart and the target
is hard to find.

## Scope

**In:** let the user change the order of pinned shortcuts; the new order
persists to `config/shortcuts.json`.

**Out (future / separate issue):** grouping, labels, dividers,
collapsible dropdowns, colour coding (issue's Design B/C/D). No `group`
field, no `groups[]` schema.

## Key realization — reorder needs no schema change

The persisted order **is** the array order:

- `normalizeShortcuts()` (`server/utils/files/shortcuts-io.ts`) rebuilds
  the array in-order — reordering survives the write.
- `reconcile()` (`useShortcuts.ts`) uses `flatMap`, preserving order.
- Persistence is a replace-all `PUT /api/shortcuts`.

So reorder = "persist the same members in a new sequence." No new
`Shortcut` field.

## Design — edit button → popover with ▲▼ per row

Chosen over direct pill drag-and-drop (e2e-fragile on a horizontal
overflow-scroll pill) and hover arrows (cramped on 8×8 pills).

- **`src/composables/shortcutReorder.ts`** (pure, unit-tested):
  `moveShortcut(list, i, dir)` (returns same ref for an end no-op),
  `isSamePermutation`, `isSameOrder`.
- **`useShortcuts.reorder(next)`**: runs through the existing mutation
  queue; rejects a `next` that isn't a permutation of the current list
  (guards against a stale caller dropping/injecting an entry); no-op when
  order is unchanged; optimistic with rollback via the shared `persist`.
- **`src/components/ShortcutReorderPopover.vue`**: an `edit` trigger +
  popover listing each shortcut with up/down arrows. Consumes
  `useShortcuts()` directly (singleton store) so `App.vue` is untouched.
  Uses the host `useClickOutside`; Escape closes. Each arrow click applies
  `moveShortcut` and persists immediately (queue serialises rapid clicks).
- **`PluginLauncher.vue`**: renders `<ShortcutReorderPopover>` as a
  sibling **after** the Group 2 pill (that pill is `overflow-x-auto` and
  would clip an absolute popover). Shown only when `shortcuts.length > 1`.
- **i18n**: `shortcuts.reorder.{open,title,moveUp,moveDown}` added to all
  8 locales.

## Tests

- `test/composables/test_shortcutReorder.ts` — 15 cases (move up/down,
  end/out-of-range no-ops returning same ref, immutability, single-element,
  kind-vs-slug identity, permutation/order predicates). Mutation-checked
  (flipping the direction turns 5 red).

## Deferred

Grouping (Design B/C/D) — needs a product call; tracked on #2519's future
scope. e2e coverage of the popover interaction can follow if desired.
