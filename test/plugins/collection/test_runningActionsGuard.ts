// Unit tests for the running-actions generation guard
// (packages/plugins/collection-plugin/src/vue/composables/runningActionsGuard.ts) —
// the stale-drop rule that keeps a slow collection-detail response from clobbering
// a newer optimistic dispatch key (Codex + CodeRabbit on PR #2104). Pinned here so
// the composable can stay a thin reactive shell.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createRunningActionsGuard } from "../../../packages/plugins/collection-plugin/src/vue/composables/runningActionsGuard";

describe("createRunningActionsGuard", () => {
  it("reflects keys added / removed through mutate", () => {
    const guard = createRunningActionsGuard();
    assert.equal(guard.isRunning("a"), false);
    guard.mutate((next) => next.add("a"));
    assert.equal(guard.isRunning("a"), true);
    guard.mutate((next) => next.delete("a"));
    assert.equal(guard.isRunning("a"), false);
  });

  it("swaps in a fresh Set on mutate (never mutates the exposed one in place)", () => {
    const guard = createRunningActionsGuard();
    const before = guard.runningActions.value;
    guard.mutate((next) => next.add("a"));
    assert.notEqual(guard.runningActions.value, before, "ref holds a new Set");
    assert.equal(before.has("a"), false, "the old Set is untouched");
  });

  it("adopts the server's keys when no local mutation raced the fetch", () => {
    const guard = createRunningActionsGuard();
    const reconcile = guard.beginReconcile();
    reconcile(["x", "y"]);
    assert.equal(guard.isRunning("x"), true);
    assert.equal(guard.isRunning("y"), true);
  });

  it("treats an undefined server list as no running actions", () => {
    const guard = createRunningActionsGuard();
    guard.mutate((next) => next.add("stale"));
    const reconcile = guard.beginReconcile();
    reconcile(undefined);
    assert.equal(guard.isRunning("stale"), false);
    assert.equal(guard.runningActions.value.size, 0);
  });

  // The flagship rule: a reconcile whose generation snapshot predates a local
  // mutation is DROPPED, so an optimistic key added mid-fetch survives.
  it("drops a stale server snapshot when a local mutation happened after the fetch began", () => {
    const guard = createRunningActionsGuard();
    const reconcile = guard.beginReconcile(); // snapshot BEFORE the optimistic add
    guard.mutate((next) => next.add("optimistic")); // dispatch races the in-flight fetch
    reconcile([]); // server response predates the dispatch — must NOT clear the key
    assert.equal(guard.isRunning("optimistic"), true, "optimistic key survives the stale reconcile");
  });

  it("applies a reconcile snapshotted AFTER the mutation (fresh, not stale)", () => {
    const guard = createRunningActionsGuard();
    guard.mutate((next) => next.add("optimistic"));
    const reconcile = guard.beginReconcile(); // snapshot AFTER the add
    reconcile(["server-key"]); // authoritative — replaces the optimistic set
    assert.equal(guard.isRunning("optimistic"), false);
    assert.equal(guard.isRunning("server-key"), true);
  });

  it("keeps concurrent reconciles independent — only the pre-mutation one is dropped", () => {
    const guard = createRunningActionsGuard();
    const stale = guard.beginReconcile();
    guard.mutate((next) => next.add("k"));
    const fresh = guard.beginReconcile();
    stale(["from-stale"]); // dropped
    assert.equal(guard.isRunning("k"), true);
    assert.equal(guard.isRunning("from-stale"), false);
    fresh(["from-fresh"]); // applied
    assert.equal(guard.isRunning("from-fresh"), true);
    assert.equal(guard.isRunning("k"), false);
  });
});
