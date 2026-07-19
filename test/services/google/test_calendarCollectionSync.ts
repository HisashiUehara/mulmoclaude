// Unit tests for the LLM-free Google Calendar → collection projection
// (#2095). The mapping is the part that silently corrupts data if it drifts:
// the primary field must always carry the Google event id (that is what makes
// a re-sync update instead of duplicate), and only declared fields may be
// written.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toCollectionRecord } from "@mulmoclaude/core/google";
import type { CalendarEventSummary } from "@mulmoclaude/core/google";

const event = (overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary => ({
  id: "ev-1",
  summary: "Standup",
  start: "2026-07-19T09:00:00+09:00",
  end: "2026-07-19T09:15:00+09:00",
  htmlLink: "https://calendar.google.com/event?eid=ev-1",
  status: "confirmed",
  colorId: "7",
  ...overrides,
});

describe("toCollectionRecord (#2095)", () => {
  it("projects mapped event fields onto the collection's own field names", () => {
    const record = toCollectionRecord(event(), { title: "summary", on: "start", until: "end" }, "gid");
    assert.equal(record.title, "Standup");
    assert.equal(record.on, "2026-07-19T09:00:00+09:00");
    assert.equal(record.until, "2026-07-19T09:15:00+09:00");
  });

  it("always writes the Google event id into the primary field", () => {
    const record = toCollectionRecord(event({ id: "abc123" }), { title: "summary" }, "gid");
    assert.equal(record.gid, "abc123");
  });

  it("writes ONLY the mapped fields plus the primary — no stray event fields leak in", () => {
    const record = toCollectionRecord(event(), { title: "summary" }, "gid");
    assert.deepEqual(Object.keys(record).sort(), ["gid", "title"]);
  });

  it("supports an empty map (records then carry just the id)", () => {
    const record = toCollectionRecord(event(), {}, "gid");
    assert.deepEqual(record, { gid: "ev-1" });
  });

  it("carries an all-day event's date values through unchanged", () => {
    const allDay = event({ start: "2026-07-19", end: "2026-07-20" });
    const record = toCollectionRecord(allDay, { on: "start", until: "end" }, "gid");
    assert.equal(record.on, "2026-07-19");
    assert.equal(record.until, "2026-07-20");
  });

  it("keeps an empty optional value as an empty string rather than dropping the key", () => {
    const record = toCollectionRecord(event({ colorId: "" }), { colour: "colorId" }, "gid");
    assert.equal(record.colour, "");
    assert.ok("colour" in record);
  });

  it("lets the primary field win even if the map tries to target it", () => {
    // Schema validation rejects this, but the projection must not corrupt the
    // id if a hand-edited schema slips through.
    const record = toCollectionRecord(event({ id: "real-id" }), { gid: "summary" }, "gid");
    assert.equal(record.gid, "real-id");
  });
});
