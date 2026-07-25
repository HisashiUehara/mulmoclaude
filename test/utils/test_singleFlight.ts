// `makeSingleFlight` coalesces a burst of triggers into one run plus one
// trailing re-run (#2427). The trailing run is the part that carries
// correctness: a pass reads the world when it starts, so a trigger that
// arrives mid-pass must still produce another pass.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeSingleFlight } from "../../server/utils/singleFlight.js";

/** A pass whose completion the test controls, so "in flight" is a real state
 *  rather than a timing guess. */
function deferredPass() {
  const releases: (() => void)[] = [];
  let started = 0;
  const pass = (): Promise<void> => {
    started += 1;
    return new Promise<void>((resolve) => releases.push(resolve));
  };
  return {
    pass,
    starts: () => started,
    releaseAll: () => {
      const pending = releases.splice(0);
      pending.forEach((release) => release());
    },
  };
}

describe("makeSingleFlight (#2427)", () => {
  it("runs the pass once for a single trigger", async () => {
    let runs = 0;
    const run = makeSingleFlight(async () => {
      runs += 1;
    });
    await run();
    assert.equal(runs, 1);
  });

  it("collapses triggers that arrive during a pass into ONE trailing re-run", async () => {
    const deferred = deferredPass();
    const run = makeSingleFlight(deferred.pass);
    const first = run();
    await Promise.resolve();
    assert.equal(deferred.starts(), 1);

    // Three more triggers while the first pass is still in flight.
    const followers = [run(), run(), run()];
    deferred.releaseAll();
    await Promise.resolve();
    assert.equal(deferred.starts(), 2, "the burst produces exactly one trailing pass");

    deferred.releaseAll();
    await Promise.all([first, ...followers]);
    assert.equal(deferred.starts(), 2, "and nothing more once the burst has drained");
  });

  it("gives every caller in a burst the same promise", async () => {
    const deferred = deferredPass();
    const run = makeSingleFlight(deferred.pass);
    const first = run();
    const second = run();
    assert.equal(first, second);
    deferred.releaseAll();
    await Promise.resolve();
    deferred.releaseAll();
    await first;
  });

  it("starts a fresh run after the previous one settled", async () => {
    let runs = 0;
    const run = makeSingleFlight(async () => {
      runs += 1;
    });
    await run();
    await run();
    assert.equal(runs, 2);
  });

  it("surfaces a failing pass to the caller and still accepts the next trigger", async () => {
    let runs = 0;
    const run = makeSingleFlight(async () => {
      runs += 1;
      if (runs === 1) throw new Error("boom");
    });
    await assert.rejects(run(), /boom/);
    await run();
    assert.equal(runs, 2, "a failed run must not wedge the slot shut");
  });
});
