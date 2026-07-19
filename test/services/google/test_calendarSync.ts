// Unit tests for `syncCalendarEvents` (#2095) — the incremental (syncToken)
// path. Google forbids combining `syncToken` with `timeMin` / `orderBy`, and
// silently drops deletions unless `showDeleted=true`, so the exact query
// shape is load-bearing and pinned here. `globalThis.fetch` is stubbed; no
// network.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { syncCalendarEvents } from "@mulmoclaude/core/google";

const realFetch = globalThis.fetch;
let requestedUrls: string[] = [];

/** Queue one JSON body (or a status) per expected page, in order. */
function stubFetch(pages: { status?: number; body?: unknown }[]): void {
  let call = 0;
  globalThis.fetch = (async (url: string | URL) => {
    requestedUrls.push(String(url));
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    const status = page.status ?? 200;
    return new Response(JSON.stringify(page.body ?? {}), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => {
  requestedUrls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const event = (eventId: string, status = "confirmed") => ({
  id: eventId,
  summary: `event ${eventId}`,
  status,
  start: { dateTime: "2026-07-17T09:00:00+09:00" },
  end: { dateTime: "2026-07-17T10:00:00+09:00" },
});

describe("syncCalendarEvents (#2095)", () => {
  it("sends showDeleted and singleEvents, and never timeMin/orderBy (forbidden with syncToken)", async () => {
    stubFetch([{ body: { items: [], nextSyncToken: "tok-1" } }]);
    await syncCalendarEvents("access-token", {});
    const [url] = requestedUrls;
    assert.ok(url.includes("showDeleted=true"), `expected showDeleted, got: ${url}`);
    assert.ok(url.includes("singleEvents=true"), `expected singleEvents, got: ${url}`);
    assert.ok(!url.includes("timeMin"), `timeMin is forbidden with syncToken, got: ${url}`);
    assert.ok(!url.includes("orderBy"), `orderBy is forbidden with syncToken, got: ${url}`);
  });

  it("omits syncToken on a full sync and sends it on an incremental one", async () => {
    stubFetch([{ body: { items: [], nextSyncToken: "tok-1" } }]);
    await syncCalendarEvents("access-token", {});
    assert.ok(!requestedUrls[0].includes("syncToken"), "first sync must not send a token");

    requestedUrls = [];
    stubFetch([{ body: { items: [], nextSyncToken: "tok-2" } }]);
    await syncCalendarEvents("access-token", { syncToken: "tok-1" });
    assert.ok(requestedUrls[0].includes("syncToken=tok-1"), `expected the stored token, got: ${requestedUrls[0]}`);
  });

  it("returns the token from the LAST page and accumulates events across pages", async () => {
    stubFetch([{ body: { items: [event("a")], nextPageToken: "p2" } }, { body: { items: [event("b")], nextSyncToken: "tok-final" } }]);
    const result = await syncCalendarEvents("access-token", {});
    assert.equal(result.events.length, 2);
    assert.deepEqual(
      result.events.map((entry) => entry.id),
      ["a", "b"],
    );
    assert.equal(result.nextSyncToken, "tok-final");
    assert.equal(result.fullResyncRequired, false);
    assert.ok(requestedUrls[1].includes("pageToken=p2"), "second page must carry the page token");
  });

  it("surfaces deletions as cancelled events rather than dropping them", async () => {
    stubFetch([{ body: { items: [event("gone", "cancelled"), event("kept")], nextSyncToken: "tok" } }]);
    const result = await syncCalendarEvents("access-token", { syncToken: "old" });
    assert.equal(result.events.filter((entry) => entry.status === "cancelled").length, 1);
    assert.equal(result.events.filter((entry) => entry.status === "cancelled")[0].id, "gone");
  });

  it("maps an expired token (410 GONE) to fullResyncRequired instead of throwing", async () => {
    stubFetch([{ status: 410, body: { error: "Sync token is no longer valid" } }]);
    const result = await syncCalendarEvents("access-token", { syncToken: "stale" });
    assert.equal(result.fullResyncRequired, true);
    assert.deepEqual(result.events, []);
    assert.equal(result.nextSyncToken, undefined);
  });

  it("still throws on a non-410 failure", async () => {
    stubFetch([{ status: 500, body: { error: "boom" } }]);
    await assert.rejects(() => syncCalendarEvents("access-token", {}), /HTTP 500/);
  });

  it("targets the requested calendar, url-encoded", async () => {
    stubFetch([{ body: { items: [], nextSyncToken: "tok" } }]);
    await syncCalendarEvents("access-token", { calendarId: "team cal@group.calendar.google.com" });
    assert.ok(requestedUrls[0].includes(encodeURIComponent("team cal@group.calendar.google.com")), `got: ${requestedUrls[0]}`);
  });
});
