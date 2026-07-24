// In-flight `kind: "agent"` action run keys, with the generation guard that
// keeps a slow detail response from clobbering a newer local dispatch.
//
// The server's detail response is the source of truth for which agent actions
// are running, but a dispatch adds its key OPTIMISTICALLY before the POST. A
// detail fetch that started BEFORE that optimistic add would, on resolving,
// carry a snapshot without the key and strand the button enabled while the
// worker runs (Codex + CodeRabbit on PR #2104). The generation counter, bumped
// on every local mutation, lets `beginReconcile` drop such a stale snapshot;
// the worker's completion ping triggers a fresh refetch that reconciles soon
// after. Extracted from CollectionView so the stale-drop rule is unit-testable.

import { ref, type Ref } from "vue";

export interface RunningActionsGuard {
  /** Reactive set of in-flight agent-action run keys (drives button spinners). */
  runningActions: Ref<Set<string>>;
  /** Whether a run key is currently in flight. */
  isRunning: (runKey: string) => boolean;
  /** Apply a local mutation to a fresh copy of the set AND bump the generation,
   *  so any server snapshot taken before this mutation is dropped by a
   *  `beginReconcile` applier that is still pending. */
  mutate: (apply: (next: Set<string>) => void) => void;
  /** Snapshot the current generation before a detail fetch; the returned applier
   *  adopts the server's keys ONLY if no local `mutate` happened while the fetch
   *  was in flight (a stale snapshot is dropped). */
  beginReconcile: () => (serverKeys: string[] | undefined) => void;
}

export function createRunningActionsGuard(): RunningActionsGuard {
  const runningActions = ref<Set<string>>(new Set());
  let generation = 0;

  const isRunning = (runKey: string): boolean => runningActions.value.has(runKey);

  const mutate = (apply: (next: Set<string>) => void): void => {
    generation += 1;
    const next = new Set(runningActions.value);
    apply(next);
    runningActions.value = next;
  };

  const beginReconcile = (): ((serverKeys: string[] | undefined) => void) => {
    const generationAtFetch = generation;
    return (serverKeys: string[] | undefined): void => {
      if (generation !== generationAtFetch) return;
      runningActions.value = new Set(serverKeys ?? []);
    };
  };

  return { runningActions, isRunning, mutate, beginReconcile };
}
