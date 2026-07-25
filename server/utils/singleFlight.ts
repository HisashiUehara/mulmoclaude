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

/** Wrap `pass` so concurrent calls share one run, with at most one queued
 *  re-run for triggers that arrived while it was in flight. The returned
 *  promise resolves when the run covering the caller finishes, and rejects
 *  with whatever `pass` threw. */
export function makeSingleFlight(pass: () => Promise<void>): () => Promise<void> {
  const slot: Slot = { running: null, pending: false };
  const loop = async (): Promise<void> => {
    try {
      let keepGoing = true;
      while (keepGoing) {
        slot.pending = false;
        await pass();
        keepGoing = slot.pending;
      }
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
