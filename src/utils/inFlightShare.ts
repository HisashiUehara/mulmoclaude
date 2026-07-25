// Collapse triggers that describe the SAME event into one pass: a call
// made while a pass is running joins it instead of starting a second.
//
// Deliberately NO trailing re-run — that is the difference from
// `makeSingleFlight` (server/utils/singleFlight.ts). There, a trigger
// arriving mid-pass stands for state the pass never looked at, so it
// must run again. Here the callers are two detections of one event (a
// tab coming back: the socket reconnecting and `visibilitychange`), so
// the second one has nothing new to report and a re-run is pure waste.
//
// Reach for `createMutationQueue` instead when every task must actually
// run, in order.

export interface InFlightShare {
  /** Run `task`, or join the pass already running. */
  run: (task: () => Promise<void>) => Promise<void>;
  /** Whether a pass is running — lets a caller log the collapse. */
  isRunning: () => boolean;
}

export function createInFlightShare(): InFlightShare {
  let running: Promise<void> | null = null;
  return {
    isRunning: () => running !== null,
    run(task) {
      // A failed pass must not wedge the slot: clearing in `finally`
      // means the next trigger starts a fresh pass rather than joining
      // a promise that has already rejected.
      running ??= task().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
