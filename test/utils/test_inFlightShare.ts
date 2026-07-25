// Unit tests for the catch-up coalescer (#2584).
//
// The behaviour under test is the ABSENCE of a second run: two triggers
// that describe one event must produce one pass. The failure mode is
// invisible in manual testing — both runs succeed, the UI looks right,
// and the only symptom is that the work happened twice.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createInFlightShare } from "../../src/utils/inFlightShare.js";

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

describe("createInFlightShare", () => {
  it("runs the task once when a second trigger arrives mid-pass", async () => {
    const share = createInFlightShare();
    const { task, resolve, runs } = deferredTask();

    const first = share.run(task);
    const second = share.run(task);

    assert.equal(runs(), 1, "the second trigger must join, not start a second pass");
    resolve();
    await Promise.all([first, second]);
    assert.equal(runs(), 1);
  });

  it("hands both callers the same promise", () => {
    const share = createInFlightShare();
    const { task, resolve } = deferredTask();
    const first = share.run(task);
    const second = share.run(task);
    assert.equal(first, second);
    resolve();
  });

  it("runs again once the previous pass has settled — a later event is a real event", async () => {
    const share = createInFlightShare();
    const { task, resolve, runs } = deferredTask();

    const first = share.run(task);
    resolve();
    await first;

    const second = share.run(task);
    assert.equal(runs(), 2, "a trigger after the pass finished must start a new one");
    resolve();
    await second;
  });

  it("does not wedge the slot when a pass rejects", async () => {
    const share = createInFlightShare();
    const failing = deferredTask();

    const first = share.run(failing.task);
    failing.reject(new Error("network"));
    await assert.rejects(first, /network/);

    const healthy = deferredTask();
    const second = share.run(healthy.task);
    assert.equal(healthy.runs(), 1, "the next trigger must run despite the previous failure");
    healthy.resolve();
    await second;
  });

  it("propagates the failure to every joiner, not just the first", async () => {
    const share = createInFlightShare();
    const { task, reject } = deferredTask();

    const first = share.run(task);
    const second = share.run(task);
    reject(new Error("boom"));

    await assert.rejects(first, /boom/);
    await assert.rejects(second, /boom/);
  });

  it("reports whether a pass is running", async () => {
    const share = createInFlightShare();
    const { task, resolve } = deferredTask();

    assert.equal(share.isRunning(), false);
    const pass = share.run(task);
    assert.equal(share.isRunning(), true, "isRunning is what lets the caller log the collapse");
    resolve();
    await pass;
    assert.equal(share.isRunning(), false);
  });

  it("collapses a burst of triggers into one pass", async () => {
    const share = createInFlightShare();
    const { task, resolve, runs } = deferredTask();

    const passes = [share.run(task), share.run(task), share.run(task), share.run(task)];
    assert.equal(runs(), 1);
    resolve();
    await Promise.all(passes);
    assert.equal(runs(), 1);
  });
});
