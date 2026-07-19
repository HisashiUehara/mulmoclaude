// Unit tests for the calendar sync-token store (#2095). The token lives IN
// the workspace (unlike the OAuth token) because it describes which records
// the workspace already holds — these tests pin the path and the per-calendar
// isolation that the incremental sync depends on.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { calendarSyncStatePath, clearCalendarSyncToken, loadCalendarSyncToken, saveCalendarSyncToken } from "@mulmoclaude/core/google";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "calendar-sync-store-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("calendar sync-token store (#2095)", () => {
  it("stores the state next to the calendar data inside the workspace", () => {
    assert.equal(calendarSyncStatePath(workspace), join(workspace, "data", "calendar", ".sync-state.json"));
  });

  it("returns null before anything has been synced", async () => {
    assert.equal(await loadCalendarSyncToken(undefined, workspace), null);
  });

  it("round-trips a token", async () => {
    await saveCalendarSyncToken(undefined, "tok-1", workspace);
    assert.equal(await loadCalendarSyncToken(undefined, workspace), "tok-1");
  });

  it("keeps a separate token per calendar", async () => {
    await saveCalendarSyncToken("work@group.calendar.google.com", "tok-work", workspace);
    await saveCalendarSyncToken("home@group.calendar.google.com", "tok-home", workspace);
    assert.equal(await loadCalendarSyncToken("work@group.calendar.google.com", workspace), "tok-work");
    assert.equal(await loadCalendarSyncToken("home@group.calendar.google.com", workspace), "tok-home");
  });

  it("treats an absent calendarId as the primary calendar", async () => {
    await saveCalendarSyncToken(undefined, "tok-primary", workspace);
    assert.equal(await loadCalendarSyncToken("primary", workspace), "tok-primary");
  });

  it("overwrites the token for the same calendar", async () => {
    await saveCalendarSyncToken(undefined, "tok-1", workspace);
    await saveCalendarSyncToken(undefined, "tok-2", workspace);
    assert.equal(await loadCalendarSyncToken(undefined, workspace), "tok-2");
  });

  it("clears only the targeted calendar's token (the 410 recovery path)", async () => {
    await saveCalendarSyncToken("a", "tok-a", workspace);
    await saveCalendarSyncToken("b", "tok-b", workspace);
    await clearCalendarSyncToken("a", workspace);
    assert.equal(await loadCalendarSyncToken("a", workspace), null);
    assert.equal(await loadCalendarSyncToken("b", workspace), "tok-b");
  });

  it("clearing an unknown calendar is a no-op, not a crash", async () => {
    await clearCalendarSyncToken("never-synced", workspace);
    assert.equal(await loadCalendarSyncToken("never-synced", workspace), null);
  });
});
