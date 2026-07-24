// Unit tests for the pure live-refresh defer logic
// (packages/plugins/collection-plugin/src/vue/liveRefresh.ts): the
// edit-in-progress DEFER rule that backs `useLiveCollectionRefresh`. A live
// refetch landing while the user has an unsaved inline/create edit would clobber
// their draft, so a change arriving mid-edit must be HELD (not refreshed, not
// dropped) until the edit ends. These pin that contract — the composable stays a
// thin reactive shell over the decision here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LIVE_REFRESH_DEBOUNCE_MS, debouncedChangeAction, shouldFlushDeferredRefresh } from "../../../packages/plugins/collection-plugin/src/vue/liveRefresh";

describe("LIVE_REFRESH_DEBOUNCE_MS", () => {
  it("is a small positive window so a bulk write collapses to one refetch", () => {
    assert.equal(LIVE_REFRESH_DEBOUNCE_MS, 150);
  });
});

describe("debouncedChangeAction", () => {
  // The guard: while an edit is open the change is DEFERRED regardless of slug —
  // never refreshed, so the user's draft is never clobbered.
  it("defers while an edit is unsaved (even on the fired slug)", () => {
    assert.equal(debouncedChangeAction(true, "todos", "todos"), "defer");
    assert.equal(debouncedChangeAction(true, "other", "todos"), "defer");
    assert.equal(debouncedChangeAction(true, undefined, "todos"), "defer");
  });

  it("refreshes when not editing and still on the collection that fired", () => {
    assert.equal(debouncedChangeAction(false, "todos", "todos"), "refresh");
  });

  // The user switched collections mid-flight — the change was for a collection
  // we're no longer viewing, so drop it.
  it("skips when not editing but the active slug moved away", () => {
    assert.equal(debouncedChangeAction(false, "other", "todos"), "skip");
    assert.equal(debouncedChangeAction(false, undefined, "todos"), "skip");
  });
});

describe("shouldFlushDeferredRefresh", () => {
  // Flush exactly once: the edit has ended AND a change was deferred while open.
  it("flushes when the edit ended and a change was deferred", () => {
    assert.equal(shouldFlushDeferredRefresh(false, true), true);
  });

  it("does NOT flush while still editing (the guard hasn't lifted)", () => {
    assert.equal(shouldFlushDeferredRefresh(true, true), false);
  });

  it("does NOT flush when nothing was deferred", () => {
    assert.equal(shouldFlushDeferredRefresh(false, false), false);
    assert.equal(shouldFlushDeferredRefresh(true, false), false);
  });
});
