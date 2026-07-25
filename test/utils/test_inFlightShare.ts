// Unit tests for the catch-up coalescer (#2584).
//
// The behaviour under test is mostly the ABSENCE of a second run: two
// triggers that describe one event must produce one pass. That failure
// mode is invisible in manual testing — both runs succeed, the UI looks
// right, and the only symptom is that the work happened twice.
//
// The keying is the other half, and it fails the opposite way: too much
// sharing silently skips a refresh the user needed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createInFlightShare } from "../../src/utils/inFlightShare.js";

const KEY = "sessions";

/** A task whose settling this test controls. */
function deferredTask(): { task: () => Promise<void>; resolve: () => void; reject: (err: Error) => void; runs: () => number } {
  let runs = 0;
  let settle: { resolve: () => void; reject: (err: Error) => void } | null = null;
  return {
    runs: () => runs,
    task: () => {
      runs += 1;
      return new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
    resolve: () => settle?.resolve(),
    reject: (err) => settle?.reject(err),
  };
}

describe("createInFlightShare — collapsing", () => {
  it("runs the task once when a second trigger arrives mid-pass", async () => {
    const share = createInFlightShare();
    const { task, resolve, runs } = deferredTask();

    const first = share.run(KEY, task);
    const second = share.run(KEY, task);

    assert.equal(runs(), 1, "the second trigger must join, not start a second pass");
    resolve();
    await Promise.all([first, second]);
    assert.equal(runs(), 1);
  });

  it("hands both callers the same promise", () => {
    const share = createInFlightShare();
    const { task, resolve } = deferredTask();
    assert.equal(share.run(KEY, task), share.run(KEY, task));
    resolve();
  });

  it("runs again once the previous pass has settled — a later event is a real event", async () => {
    const share = createInFlightShare();
    const { task, resolve, runs } = deferredTask();

    const first = share.run(KEY, task);
    resolve();
    await first;

    const second = share.run(KEY, task);
    assert.equal(runs(), 2, "a trigger after the pass finished must start a new one");
    resolve();
    await second;
  });

  it("collapses a burst of triggers into one pass", async () => {
    const share = createInFlightShare();
    const { task, resolve, runs } = deferredTask();

    const passes = [share.run(KEY, task), share.run(KEY, task), share.run(KEY, task), share.run(KEY, task)];
    assert.equal(runs(), 1);
    resolve();
    await Promise.all(passes);
    assert.equal(runs(), 1);
  });
});

describe("createInFlightShare — keying", () => {
  // The regression this guards: `loadSession` reuses an already-visited
  // session WITHOUT re-fetching, so a trigger that joined the previous
  // session's pass would leave the newly-displayed one stale with
  // nothing left to refresh it.
  it("does not let a different key join an unrelated pass", async () => {
    const share = createInFlightShare();
    const sessionA = deferredTask();
    const sessionB = deferredTask();

    const passA = share.run("transcript:A", sessionA.task);
    const passB = share.run("transcript:B", sessionB.task);

    assert.equal(sessionA.runs(), 1);
    assert.equal(sessionB.runs(), 1, "a trigger for another session must run, not join session A");
    assert.notEqual(passA, passB);
    sessionA.resolve();
    sessionB.resolve();
    await Promise.all([passA, passB]);
  });

  it("tracks each key independently", async () => {
    const share = createInFlightShare();
    const { task, resolve } = deferredTask();

    const pass = share.run("transcript:A", task);
    assert.equal(share.isRunning("transcript:A"), true);
    assert.equal(share.isRunning("transcript:B"), false);
    resolve();
    await pass;
  });

  it("forgets a key once its pass settles, so the map can't grow per visited session", async () => {
    const share = createInFlightShare();
    const { task, resolve } = deferredTask();

    const pass = share.run("transcript:A", task);
    resolve();
    await pass;
    assert.equal(share.isRunning("transcript:A"), false);
  });
});

describe("createInFlightShare — failures", () => {
  it("does not wedge the key when a pass rejects", async () => {
    const share = createInFlightShare();
    const failing = deferredTask();

    const first = share.run(KEY, failing.task);
    failing.reject(new Error("network"));
    await assert.rejects(first, /network/);

    const healthy = deferredTask();
    const second = share.run(KEY, healthy.task);
    assert.equal(healthy.runs(), 1, "the next trigger must run despite the previous failure");
    healthy.resolve();
    await second;
  });

  it("propagates the failure to every joiner, not just the first", async () => {
    const share = createInFlightShare();
    const { task, reject } = deferredTask();

    const first = share.run(KEY, task);
    const second = share.run(KEY, task);
    reject(new Error("boom"));

    await assert.rejects(first, /boom/);
    await assert.rejects(second, /boom/);
  });

  // Called bare, a synchronous throw would escape `run` before the entry
  // is registered — the caller gets an exception instead of a promise and
  // joiners have nothing to await (CodeRabbit, PR #2585).
  it("turns a synchronously throwing task into a rejected shared promise", async () => {
    const share = createInFlightShare();
    const throwing = (): Promise<void> => {
      throw new Error("sync");
    };

    // Before the fix this line THREW rather than returning, so the
    // regression shows up as the test failing right here with "sync".
    const pass = share.run(KEY, throwing);

    await assert.rejects(pass, /sync/);
    assert.equal(share.isRunning(KEY), false, "the key must be released after a synchronous failure too");
  });
});
