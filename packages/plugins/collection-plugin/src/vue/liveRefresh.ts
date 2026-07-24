// Pure decision logic for the pub/sub live-refresh (`useLiveCollectionRefresh`):
// the debounce window plus the edit-in-progress DEFER rule. A live refetch that
// landed while the user has an unsaved inline/create edit would clobber their
// draft, so a change arriving mid-edit is DEFERRED (held, not dropped) until the
// edit ends. Split out of the composable so the defer rule is unit-testable and
// the reactive shell stays thin.

/** Debounce window: a bulk write (N rows) collapses to one refetch. */
export const LIVE_REFRESH_DEBOUNCE_MS = 150;

/** What the debounced change should do once the timer fires. */
export type LiveRefreshAction = "refresh" | "defer" | "skip";

/** The debounced-change decision:
 *  - `defer`  while an edit is unsaved — hold the change so a refetch never
 *    clobbers the user's draft (the flag the edit-end flush later drains);
 *  - `refresh` when not editing AND still on the collection that fired the
 *    change;
 *  - `skip`   when the user switched collections mid-flight (drop it). */
export function debouncedChangeAction(isEditing: boolean, activeSlug: string | undefined, firedSlug: string): LiveRefreshAction {
  if (isEditing) return "defer";
  return activeSlug === firedSlug ? "refresh" : "skip";
}

/** Whether an ended edit should flush a deferred change: only once the edit
 *  actually ends (`editing` back to null) AND a change was deferred while it was
 *  open. The save path refetches on its own, but a CANCEL has no other refresh
 *  path — without this a cancelled edit would strand the deferred update. */
export function shouldFlushDeferredRefresh(isEditing: boolean, pending: boolean): boolean {
  return !isEditing && pending;
}
