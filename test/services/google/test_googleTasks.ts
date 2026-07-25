// Unit tests for the Tasks REST mapping helpers — pure functions only, no
// network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildTaskPatch, canonicalTaskListId, toTaskListSummary, toTaskSummary } from "@mulmoclaude/core/google";

// Blank must resolve to the default list, not to "" — otherwise the URL builder
// produces `/lists//tasks`, which 404s instead of hitting the user's default.
// Same rule (and same reason) as `canonicalCalendarId` for `/calendars//events`.
describe("canonicalTaskListId", () => {
  it("falls back to @default when the id is missing", () => {
    assert.equal(canonicalTaskListId(undefined), "@default");
  });

  it("falls back for an empty string — the case `??` would have let through", () => {
    assert.equal(canonicalTaskListId(""), "@default");
  });

  it("falls back for whitespace", () => {
    assert.equal(canonicalTaskListId("   "), "@default");
  });

  it("keeps a real id, trimmed", () => {
    assert.equal(canonicalTaskListId("MTIzNDU2"), "MTIzNDU2");
    assert.equal(canonicalTaskListId("  MTIzNDU2  "), "MTIzNDU2");
  });
});

describe("toTaskSummary", () => {
  it("maps a full task", () => {
    assert.deepEqual(toTaskSummary({ id: "t1", title: "Buy milk", status: "needsAction", due: "2026-07-18T00:00:00.000Z", notes: "2%" }), {
      id: "t1",
      title: "Buy milk",
      status: "needsAction",
      due: "2026-07-18T00:00:00.000Z",
      notes: "2%",
    });
  });

  it("fills missing and non-string fields with empty strings rather than undefined", () => {
    assert.deepEqual(toTaskSummary({ id: "t1", title: 42 }), { id: "t1", title: "", status: "", due: "", notes: "" });
  });

  it("survives a non-object payload", () => {
    assert.deepEqual(toTaskSummary(null), { id: "", title: "", status: "", due: "", notes: "" });
  });
});

describe("toTaskListSummary", () => {
  it("maps id and title", () => {
    assert.deepEqual(toTaskListSummary({ id: "l1", title: "My list", extra: true }), { id: "l1", title: "My list" });
  });

  it("survives a non-object payload", () => {
    assert.deepEqual(toTaskListSummary(undefined), { id: "", title: "" });
  });
});

describe("buildTaskPatch (#2569)", () => {
  it("sends only what the caller asked to change", () => {
    assert.deepEqual(buildTaskPatch({ taskId: "t1", title: "Renamed" }), { title: "Renamed" });
  });

  it("sends nothing when nothing changed — taskId and taskListId address, they do not edit", () => {
    assert.deepEqual(buildTaskPatch({ taskId: "t1", taskListId: "l1" }), {});
  });

  it('keeps notes: "" — it clears them', () => {
    assert.deepEqual(buildTaskPatch({ taskId: "t1", notes: "" }), { notes: "" });
  });

  // `completeTask` owns the status transition. A second way to set it here
  // would drift from that one, so the patch must never carry a status.
  it("never sends a status, whatever the caller passes", () => {
    const patch = buildTaskPatch({ taskId: "t1", title: "x", notes: "y", due: "2026-07-18T00:00:00Z" });
    assert.equal("status" in patch, false);
  });

  it("carries every editable field together", () => {
    const patch = buildTaskPatch({ taskId: "t1", title: "T", notes: "N", due: "2026-07-18T09:00:00+09:00" });
    assert.deepEqual(patch, { title: "T", notes: "N", due: "2026-07-18T09:00:00+09:00" });
  });
});
