// E2E: the standalone /collections/:slug table's flag filter chips
// (plans/feat-collection-flag-fields.md, reframing #2174). A `flag` field
// gets a tri-state chip (all → hide → only) that narrows the table rows
// and persists per-collection in localStorage; a legacy completion-pair
// schema (no flag field) gets a synthesized "done" chip driven by the
// same predicate, so hide-completed works without a schema edit.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const TASKS = {
  collection: {
    slug: "tasks",
    title: "Tasks",
    icon: "checklist",
    source: "user",
    schema: {
      title: "Tasks",
      icon: "checklist",
      dataPath: "data/tasks/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name" },
        status: { type: "enum", label: "Status", values: ["todo", "doing", "done", "canceled"] },
        isDone: { type: "flag", label: "Done", where: [{ field: "status", op: "in", value: ["done", "canceled"] }] },
        // Deliberately named after an Object.prototype member: chip-state
        // lookups must read OWN properties, or this chip reads the
        // inherited function as "active" and can never cycle.
        toString: { type: "flag", label: "Open", where: [{ field: "status", op: "eq", value: "todo" }] },
      },
    },
  },
  items: [
    { id: "t1", name: "Open task", status: "todo" },
    { id: "t2", name: "Finished task", status: "done" },
    { id: "t3", name: "Dropped task", status: "canceled" },
  ],
};

// Same records, but done-ness declared ONLY via the legacy completion
// pair — no flag field in the schema.
const TODOS = {
  collection: {
    slug: "todos",
    title: "Todos",
    icon: "check_circle",
    source: "user",
    schema: {
      title: "Todos",
      icon: "check_circle",
      dataPath: "data/todos/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name" },
        status: { type: "enum", label: "Status", values: ["todo", "done"] },
      },
      completionField: "status",
      completionDoneValues: ["done"],
    },
  },
  items: [
    { id: "t1", name: "Open todo", status: "todo" },
    { id: "t2", name: "Finished todo", status: "done" },
  ],
};

async function mockCollection(page: Page, slug: string, payload: object): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/collections/${slug}`,
    (route) => route.fulfill({ json: payload }),
  );
}

/** Assert exactly `ids` render as table rows (order-insensitive here —
 *  the chip filters, sorting is pinned elsewhere). */
async function expectRows(page: Page, ids: string[]): Promise<void> {
  const rows = page.locator('[data-testid^="collections-row-"]');
  await expect(rows).toHaveCount(ids.length);
  for (const rowId of ids) {
    await expect(page.getByTestId(`collections-row-${rowId}`)).toBeVisible();
  }
}

test("flag chip cycles all → hide → only, filters the table, and persists", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page, "tasks", TASKS);

  await page.goto("/collections/tasks");
  await expectRows(page, ["t1", "t2", "t3"]);

  const chip = page.getByTestId("collections-flag-chip-isDone");
  await expect(chip).toContainText("Done");

  // hide → only the open task remains.
  await chip.click();
  await expectRows(page, ["t1"]);

  // only → just the done/canceled rows.
  await chip.click();
  await expectRows(page, ["t2", "t3"]);

  // Reload: the "only" state must survive (localStorage, keyed by slug).
  await page.reload();
  await expectRows(page, ["t2", "t3"]);

  // Third click clears the filter → everything again.
  await page.getByTestId("collections-flag-chip-isDone").click();
  await expectRows(page, ["t1", "t2", "t3"]);
});

test("a flag named after an Object.prototype member still cycles", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page, "tasks", TASKS);

  await page.goto("/collections/tasks");
  await expectRows(page, ["t1", "t2", "t3"]);

  // `toString` shadows Object.prototype — a plain-object lookup would read
  // the inherited function, leaving this chip stuck in the default state.
  const chip = page.getByTestId("collections-flag-chip-toString");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.click(); // hide the open task
  await expectRows(page, ["t2", "t3"]);
  await chip.click(); // only the open task
  await expectRows(page, ["t1"]);
  await chip.click(); // back to all
  await expectRows(page, ["t1", "t2", "t3"]);
  await expect(chip).toHaveAttribute("aria-pressed", "false");
});

test("flag cells render as read-only checks in the table", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page, "tasks", TASKS);

  await page.goto("/collections/tasks");
  await expect(page.getByTestId("collections-flag-isDone-t2")).toHaveText("check_circle");
  await expect(page.getByTestId("collections-flag-isDone-t1")).toHaveText("radio_button_unchecked");
});

test("legacy completion pair gets a synthesized done chip (no schema edit)", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page, "todos", TODOS);

  await page.goto("/collections/todos");
  await expectRows(page, ["t1", "t2"]);

  // hide → the done todo disappears; the count summary reflects it.
  await page.getByTestId("collections-flag-chip-__completion").click();
  await expectRows(page, ["t1"]);
  await expect(page.getByText("Showing 1 of 2")).toBeVisible();
});
