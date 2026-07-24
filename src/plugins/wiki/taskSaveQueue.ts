// The serialised save queue behind wiki task-checkbox toggles (#775),
// extracted from useWikiPageSave so its intricate ordering rules can be
// unit-tested without a Vue runtime. The composable keeps only the DOM /
// optimistic-update glue; every decision below is pure control flow over
// injected dependencies.
//
// The rules, in one place:
//   - Each click queues onto the previous save (a slow network can't
//     reorder writes).
//   - A `generation` counter invalidates saves whose captured snapshot was
//     computed against optimistic state that a failure-triggered refresh
//     has since discarded.
//   - A page switch mid-flight (checked before AND after the request)
//     abandons the save — writing this page's snapshot onto a different
//     page would clobber unrelated state.
//   - On failure the generation bump happens AFTER refresh completes, so
//     clicks that arrived WHILE the refresh was in flight (they captured
//     the pre-bump generation) are invalidated too.
//   - The chain is self-healing: a rejected persist must not leave the
//     chain permanently rejected (which would silently drop every later
//     click).

export interface SaveResult {
  ok: boolean;
  /** 0 for a network-level failure, else the HTTP status. */
  status: number;
  error: string;
}

export interface TaskSaveQueueDeps {
  /** Perform the actual save. Returns a discriminated ok/err result. */
  persist: (pageName: string, content: string) => Promise<SaveResult>;
  /** Reload canonical page state after a failed save. */
  refresh: () => Promise<unknown>;
  /** The slug the view is currently showing — read at each checkpoint. */
  getCurrentSlug: () => string | null;
  /** Surface a save failure to the user. */
  onError: (message: string) => void;
  /** Clear any prior error after a successful save. */
  onSuccess: () => void;
}

export interface TaskSaveQueue {
  /** Queue a save of `content` for `pageName` onto the serialised chain. */
  queueSave: (pageName: string, content: string) => void;
}

export function createTaskSaveQueue(deps: TaskSaveQueueDeps): TaskSaveQueue {
  let chain: Promise<unknown> = Promise.resolve();
  let generation = 0;

  async function persistOne(pageName: string, content: string, capturedGeneration: number): Promise<void> {
    // Stale queued save (a previous save failed + refresh discarded the
    // optimistic state this snapshot was based on).
    if (capturedGeneration !== generation) return;
    // Navigation changed before we even started — the route/result watchers
    // already load the right page; saving this snapshot would clobber it.
    if (deps.getCurrentSlug() !== pageName) return;

    const result = await deps.persist(pageName, content);

    // Re-check both invariants after the await: either could have changed
    // while the request was in flight.
    if (capturedGeneration !== generation) return;
    if (deps.getCurrentSlug() !== pageName) return;

    if (!result.ok) {
      deps.onError(result.status === 0 ? result.error : `Wiki save failed (${result.status}): ${result.error}`);
      // Bump AFTER refresh: clicks arriving WHILE refresh is in flight
      // captured the pre-bump generation, so bumping post-refresh
      // invalidates them too.
      await deps.refresh();
      generation += 1;
      return;
    }
    deps.onSuccess();
  }

  function queueSave(pageName: string, content: string): void {
    const capturedGeneration = generation;
    // `.catch` keeps the chain self-healing: an uncaught rejection would
    // leave the chain permanently rejected and silently drop every later
    // click. The error is already surfaced via onError inside persistOne.
    chain = chain.then(() => persistOne(pageName, content, capturedGeneration)).catch(() => undefined);
  }

  return { queueSave };
}
