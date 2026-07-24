import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { flagFilterModeOf } from "@mulmoclaude/collection-plugin/vue";
import type { FlagFilterState } from "@mulmoclaude/collection-plugin/vue";

describe("flagFilterModeOf", () => {
  it("returns the stored mode for a present key", () => {
    const filters: FlagFilterState = { isDone: "only", urgent: "hide" };
    assert.equal(flagFilterModeOf(filters, "isDone"), "only");
    assert.equal(flagFilterModeOf(filters, "urgent"), "hide");
  });

  it("returns undefined for a key with no entry", () => {
    assert.equal(flagFilterModeOf({ isDone: "hide" }, "missing"), undefined);
  });

  it("returns undefined for an empty state", () => {
    assert.equal(flagFilterModeOf({}, "anything"), undefined);
  });

  // Regression (Codex on PR #2176): a flag field named after an
  // Object.prototype member must read as OWN-property-only. A plain
  // `filters[key]` would surface the inherited function, which renders as a
  // permanently-"active" chip that can never cycle.
  it("does not read through the prototype chain for shadowing keys", () => {
    assert.equal(flagFilterModeOf({}, "toString"), undefined);
    assert.equal(flagFilterModeOf({}, "valueOf"), undefined);
    assert.equal(flagFilterModeOf({}, "hasOwnProperty"), undefined);
  });

  it("still reads an own property whose key shadows a prototype member", () => {
    // Assigned via bracket access (an object literal with a `toString` key
    // trips a TS check against Object.prototype.toString's signature).
    const filters: FlagFilterState = {};
    filters["toString"] = "only";
    assert.equal(flagFilterModeOf(filters, "toString"), "only");
  });
});
