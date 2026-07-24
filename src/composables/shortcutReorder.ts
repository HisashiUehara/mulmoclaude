// Pure ordering logic for the pinned-shortcut reorder popover. Kept
// separate from `useShortcuts` (which owns the persist / IO) so the
// array math is unit-testable without a store or a network stub.
//
// The persisted order IS the array order — `normalizeShortcuts`
// (server) and `reconcile` (client) both preserve it — so reordering
// only rewrites the same members in a new sequence; no schema field.

import { sameShortcut, type Shortcut } from "../types/shortcuts";

export type MoveDirection = "up" | "down";

/** Move the item at `index` one slot in `direction`, returning a NEW
 *  array. An out-of-range index, or a move that would fall off either
 *  end (up from first / down from last), returns the SAME array
 *  reference unchanged so the caller can skip a needless persist. Never
 *  mutates the input. */
export function moveShortcut(list: Shortcut[], index: number, direction: MoveDirection): Shortcut[] {
  if (index < 0 || index >= list.length) return list;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** True when `left` and `right` hold the same members (by kind+slug) regardless
 *  of order — the guard that a reorder neither added nor dropped an
 *  entry. Assumes both are dedup'd on (kind, slug) (the normalizer
 *  guarantees it), so equal length + full containment implies a
 *  bijection. */
export function isSamePermutation(left: Shortcut[], right: Shortcut[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry) => right.some((other) => sameShortcut(entry, other)));
}

/** True when `left` and `right` list the same members in the identical order. */
export function isSameOrder(left: Shortcut[], right: Shortcut[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => sameShortcut(entry, right[index]));
}
