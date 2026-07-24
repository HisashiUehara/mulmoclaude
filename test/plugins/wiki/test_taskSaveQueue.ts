import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTaskSaveQueue, type SaveResult } from "../../../src/plugins/wiki/taskSaveQueue.js";

// A controllable persist: each call parks on a promise the test resolves by
// hand, so ordering and mid-flight state changes are deterministic.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ok: SaveResult = { ok: true, status: 200, error: "" };
const httpFail: SaveResult = { ok: false, status: 500, error: "boom" };
const netFail: SaveResult = { ok: false, status: 0, error: "offline" };

interface Harness {
  slug: string;
  persistCalls: { pageName: string; content: string }[];
  refreshCalls: number;
  errors: string[];
  successes: number;
}

// Build a queue whose persist resolves immediately with a scripted sequence
// of results. Returns the harness so tests can assert side effects.
function immediateHarness(results: SaveResult[]): { queue: ReturnType<typeof createTaskSaveQueue>; harness: Harness } {
  const harness: Harness = { slug: "page-a", persistCalls: [], refreshCalls: 0, errors: [], successes: 0 };
  let index = 0;
  const queue = createTaskSaveQueue({
    persist: async (pageName, content) => {
      harness.persistCalls.push({ pageName, content });
      return results[index++] ?? ok;
    },
    refresh: async () => {
      harness.refreshCalls += 1;
    },
    getCurrentSlug: () => harness.slug,
    onError: (msg) => harness.errors.push(msg),
    onSuccess: () => {
      harness.successes += 1;
    },
  });
  return { queue, harness };
}

// Let the microtask chain drain.
const flush = () => new Promise((resolveFn) => setTimeout(resolveFn, 0));

const contents = (harness: Harness): string[] => harness.persistCalls.map((rec) => rec.content);

describe("createTaskSaveQueue — happy path", () => {
  it("persists a queued save and clears the error", async () => {
    const { queue, harness } = immediateHarness([ok]);
    queue.queueSave("page-a", "c1");
    await flush();
    assert.deepEqual(harness.persistCalls, [{ pageName: "page-a", content: "c1" }]);
    assert.equal(harness.successes, 1);
    assert.equal(harness.errors.length, 0);
  });

  it("serialises multiple clicks in order", async () => {
    const { queue, harness } = immediateHarness([ok, ok, ok]);
    queue.queueSave("page-a", "c1");
    queue.queueSave("page-a", "c2");
    queue.queueSave("page-a", "c3");
    await flush();
    assert.deepEqual(contents(harness), ["c1", "c2", "c3"]);
  });
});

describe("createTaskSaveQueue — page switch", () => {
  it("drops a save whose page is no longer current before the request", async () => {
    const { queue, harness } = immediateHarness([ok]);
    harness.slug = "page-b"; // user navigated away before the queued save ran
    queue.queueSave("page-a", "c1");
    await flush();
    assert.equal(harness.persistCalls.length, 0, "must not persist page-a's snapshot while on page-b");
  });

  it("drops the result when the page changes DURING the request", async () => {
    const harness: Harness = { slug: "page-a", persistCalls: [], refreshCalls: 0, errors: [], successes: 0 };
    const gate = deferred<SaveResult>();
    const queue = createTaskSaveQueue({
      persist: async (pageName, content) => {
        harness.persistCalls.push({ pageName, content });
        return gate.promise;
      },
      refresh: async () => {
        harness.refreshCalls += 1;
      },
      getCurrentSlug: () => harness.slug,
      onError: (msg) => harness.errors.push(msg),
      onSuccess: () => {
        harness.successes += 1;
      },
    });
    queue.queueSave("page-a", "c1");
    await flush();
    assert.equal(harness.persistCalls.length, 1);
    harness.slug = "page-b"; // navigated away while the request is in flight
    gate.resolve(ok);
    await flush();
    // The success callback must NOT fire — the result is for a page we left.
    assert.equal(harness.successes, 0);
  });
});

describe("createTaskSaveQueue — failure + generation invalidation", () => {
  it("surfaces an HTTP failure, refreshes, and clears success", async () => {
    const { queue, harness } = immediateHarness([httpFail]);
    queue.queueSave("page-a", "c1");
    await flush();
    assert.equal(harness.errors.length, 1);
    assert.match(harness.errors[0], /Wiki save failed \(500\)/);
    assert.equal(harness.refreshCalls, 1);
    assert.equal(harness.successes, 0);
  });

  it("formats a network failure (status 0) without an HTTP code", async () => {
    const { queue, harness } = immediateHarness([netFail]);
    queue.queueSave("page-a", "c1");
    await flush();
    assert.equal(harness.errors[0], "offline");
  });

  // The core #775 invariant: a save that FAILED invalidates saves queued
  // before its generation bump (their snapshots were built on now-discarded
  // optimistic state), so they must not reach the server.
  it("invalidates saves queued before a failure's generation bump", async () => {
    const harness: Harness = { slug: "page-a", persistCalls: [], refreshCalls: 0, errors: [], successes: 0 };
    const firstGate = deferred<SaveResult>();
    let callCount = 0;
    const queue = createTaskSaveQueue({
      persist: async (pageName, content) => {
        harness.persistCalls.push({ pageName, content });
        callCount += 1;
        return callCount === 1 ? firstGate.promise : ok;
      },
      refresh: async () => {
        harness.refreshCalls += 1;
      },
      getCurrentSlug: () => harness.slug,
      onError: (msg) => harness.errors.push(msg),
      onSuccess: () => {
        harness.successes += 1;
      },
    });
    // Two clicks captured while generation is 0.
    queue.queueSave("page-a", "c1");
    queue.queueSave("page-a", "c2");
    await flush();
    assert.equal(harness.persistCalls.length, 1, "second save waits behind the first");
    firstGate.resolve(httpFail); // first fails → refresh → generation bumps to 1
    await flush();
    // c2 captured generation 0, now stale → must be skipped, never persisted.
    assert.deepEqual(contents(harness), ["c1"], "the stale c2 save must not reach the server");
  });
});

describe("createTaskSaveQueue — self-healing chain", () => {
  it("keeps accepting clicks after a persist throws", async () => {
    const harness: Harness = { slug: "page-a", persistCalls: [], refreshCalls: 0, errors: [], successes: 0 };
    let callCount = 0;
    const queue = createTaskSaveQueue({
      persist: async (pageName, content) => {
        harness.persistCalls.push({ pageName, content });
        callCount += 1;
        if (callCount === 1) throw new Error("network exploded");
        return ok;
      },
      refresh: async () => {
        harness.refreshCalls += 1;
      },
      getCurrentSlug: () => harness.slug,
      onError: (msg) => harness.errors.push(msg),
      onSuccess: () => {
        harness.successes += 1;
      },
    });
    queue.queueSave("page-a", "c1"); // throws
    await flush();
    queue.queueSave("page-a", "c2"); // must still run despite the prior rejection
    await flush();
    assert.deepEqual(contents(harness), ["c1", "c2"]);
    assert.equal(harness.successes, 1);
  });
});
