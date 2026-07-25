// E2E coverage for the header's Refresh button gate (#2427). The button used
// to appear only for a feed (`schema.ingest`); a `googleCalendar` collection
// now gets it too, labelled for a sync rather than a feed refresh, and clicking
// it POSTs the same collection refresh route.
//
// Pinned here because the gate is the difference between "the user can ask for
// a sync" and "the user waits up to an hour with no control" — and because the
// obvious way to break it is to widen it, so the no-button case is pinned too.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const baseSchema = {
  title: "My Schedule",
  icon: "event",
  dataPath: "data/collections/my-schedule/items",
  primaryKey: "gid",
  fields: {
    gid: { type: "string", label: "ID", primary: true, required: true },
    title: { type: "string", label: "Event" },
  },
};

const CALENDAR_COLLECTION = {
  collection: {
    slug: "my-schedule",
    title: "My Schedule",
    icon: "event",
    source: "user",
    schema: { ...baseSchema, googleCalendar: { calendarId: "primary", map: { title: "summary" } } },
  },
  items: [{ gid: "ev-1", title: "Standup" }],
};

const PLAIN_COLLECTION = {
  collection: { slug: "my-schedule", title: "My Schedule", icon: "event", source: "user", schema: baseSchema },
  items: [{ gid: "ev-1", title: "Standup" }],
};

async function mockCollection(page: Page, payload: unknown): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections/my-schedule",
    (route) => route.fulfill({ json: payload }),
  );
}

test.describe("googleCalendar collection sync button", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("offers a Sync button that runs the collection refresh route", async ({ page }) => {
    await mockCollection(page, CALENDAR_COLLECTION);
    const refreshCalls: string[] = [];
    await page.route(
      (url) => url.pathname === "/api/collections/my-schedule/refresh",
      (route) => {
        refreshCalls.push(route.request().method());
        return route.fulfill({ json: { refreshed: true, written: 1, removed: 0, errors: [] } });
      },
    );

    await page.goto("/collections/my-schedule");
    const sync = page.getByTestId("collections-refresh-feed");
    await expect(sync).toBeVisible();
    // Labelled for a calendar, not "Refresh" — the two run different engines.
    await expect(sync).toHaveText(/Sync/);

    await sync.click();
    await expect.poll(() => refreshCalls).toEqual(["POST"]);
  });

  test("shows no button for a collection that declares neither ingest nor googleCalendar", async ({ page }) => {
    await mockCollection(page, PLAIN_COLLECTION);
    await page.goto("/collections/my-schedule");
    await expect(page.getByTestId("collections-chat")).toBeVisible();
    await expect(page.getByTestId("collections-refresh-feed")).toHaveCount(0);
  });
});
