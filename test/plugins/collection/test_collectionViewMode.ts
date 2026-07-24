// Unit tests for the pure view-mode resolution logic
// (packages/plugins/collection-plugin/src/vue/collectionViewMode.ts): the
// stale-mode collapse (`resolveActiveViewMode`) and the built-in narrowing
// (`builtInViewOrTable`). These back `useViewMode`, keeping the composable a thin
// reactive shell. The localStorage read/write halves of the module touch a
// browser global, so they're exercised by the collection-state-persist e2e; here
// we pin the field-derived decision the component's body branches key off.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveActiveViewMode, builtInViewOrTable, type CollectionViewMode } from "../../../packages/plugins/collection-plugin/src/vue/collectionViewMode";

describe("resolveActiveViewMode", () => {
  it("keeps table always (no gating field required)", () => {
    assert.equal(resolveActiveViewMode("table", false, false, []), "table");
    assert.equal(resolveActiveViewMode("table", true, true, ["a"]), "table");
  });

  it("keeps calendar only while a date field gates it", () => {
    assert.equal(resolveActiveViewMode("calendar", true, false, []), "calendar");
  });

  // The core collapse: a stored `calendar` whose date field vanished (e.g. after a
  // collection switch) must fall back to `table`, not render an empty grid.
  it("collapses calendar to table when no date field", () => {
    assert.equal(resolveActiveViewMode("calendar", false, false, []), "table");
  });

  it("keeps kanban only while an enum field gates it", () => {
    assert.equal(resolveActiveViewMode("kanban", false, true, []), "kanban");
  });

  it("collapses kanban to table when no enum field", () => {
    assert.equal(resolveActiveViewMode("kanban", false, false, []), "table");
  });

  // A kanban mode must NOT be rescued by the calendar gate (each branch checks its
  // own field only).
  it("does not let the calendar gate rescue a kanban mode", () => {
    assert.equal(resolveActiveViewMode("kanban", true, false, []), "table");
  });

  it("keeps a custom mode while its id is still a declared view", () => {
    assert.equal(resolveActiveViewMode("custom:board", false, false, ["board", "other"]), "custom:board");
  });

  it("collapses a custom mode to table when its id is gone", () => {
    assert.equal(resolveActiveViewMode("custom:board", true, true, ["other"]), "table");
    assert.equal(resolveActiveViewMode("custom:board", false, false, []), "table");
  });
});

describe("builtInViewOrTable", () => {
  it("passes the built-in date/enum modes through", () => {
    assert.equal(builtInViewOrTable("calendar"), "calendar");
    assert.equal(builtInViewOrTable("kanban"), "kanban");
    assert.equal(builtInViewOrTable("table"), "table");
  });

  it("narrows a custom mode to table (custom views aren't representable in card viewState)", () => {
    const custom: CollectionViewMode = "custom:board";
    assert.equal(builtInViewOrTable(custom), "table");
  });
});
