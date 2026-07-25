// Coalesce a repeatedly-triggered background pass into one run at a time.
//
// A trailing re-run (rather than dropping the extra trigger) is the part that
// matters for correctness: a pass reads the world when it starts, so a change
// that lands mid-pass would be invisible to it — the trailing run is what sees
// that change. Shaped after the per-slug loop in `collection-watchers`.

interface Slot {
  running: Promise<void> | null;
  pending: boolean;
}

/** Run `pass` until no trigger arrived during the last run, RETURNING the first
 *  failure instead of throwing it.
 *
 *  Returning is what lets the queue keep draining after a failed pass: the
 *  trigger that arrived while it ran stands for state that pass never looked
 *  at, so dropping it would strand that state until something else fires
 *  (CodeRabbit review #2566). */
async function drain(pass: () => Promise<void>, slot: Slot): Promise<{ error: unknown } | null> {
  let failure: { error: unknown } | null = null;
  let keepGoing = true;
  while (keepGoing) {
    slot.pending = false;
    try {
      await pass();
    } catch (error) {
      failure ??= { error };
    }
    keepGoing = slot.pending;
  }
  return failure;
}

/** Wrap `pass` so concurrent calls share one run, with a queued re-run for
 *  triggers that arrived while it was in flight. The returned promise resolves
 *  when the run covering the caller finishes, and rejects with whatever `pass`
 *  threw first. */
export function makeSingleFlight(pass: () => Promise<void>): () => Promise<void> {
  const slot: Slot = { running: null, pending: false };
  const loop = async (): Promise<void> => {
    try {
      const failure = await drain(pass, slot);
      if (failure) throw failure.error;
    } finally {
      slot.running = null;
    }
  };
  return () => {
    if (slot.running) {
      slot.pending = true;
      return slot.running;
    }
    slot.running = loop();
    return slot.running;
  };
}
