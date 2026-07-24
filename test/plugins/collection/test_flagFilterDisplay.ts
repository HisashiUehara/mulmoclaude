// Unit tests for the pure flag-filter decision + presentation logic
// (packages/plugins/collection-plugin/src/vue/flagFilterDisplay.ts) — the
// tri-state transition, the own-property mode read (guarding against a field
// named after an Object.prototype member — Codex #2176), the state rebuild on a
// cycle, and the icon / colour mappings. Pinned here so the composable stays a
// thin reactive shell.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildFlagChips,
  nextFlagFilterMode,
  flagFilterModeOf,
  cycleFlagFilterState,
  flagChipIconForMode,
  flagChipIconClassForMode,
  flagChipClassForMode,
  type FlagChipSchemaView,
} from "../../../packages/plugins/collection-plugin/src/vue/flagFilterDisplay";
import type { FlagFilterState } from "../../../packages/plugins/collection-plugin/src/vue/collectionViewMode";

describe("nextFlagFilterMode", () => {
  it("cycles all → hide → only → all", () => {
    assert.equal(nextFlagFilterMode(undefined), "hide");
    assert.equal(nextFlagFilterMode("hide"), "only");
    assert.equal(nextFlagFilterMode("only"), undefined);
  });
});

describe("flagFilterModeOf", () => {
  it("reads an own property's mode", () => {
    assert.equal(flagFilterModeOf({ done: "hide" }, "done"), "hide");
    assert.equal(flagFilterModeOf({ done: "only" }, "done"), "only");
  });

  it("returns undefined for an absent key", () => {
    assert.equal(flagFilterModeOf({}, "done"), undefined);
  });

  // Regression (Codex #2176): a field named after an Object.prototype member must
  // read as ABSENT, not the inherited function — else the chip renders "active"
  // and can never cycle.
  it("does not read through the prototype chain for a shadowing key", () => {
    assert.equal(flagFilterModeOf({}, "toString"), undefined);
    assert.equal(flagFilterModeOf({}, "valueOf"), undefined);
    assert.equal(flagFilterModeOf({}, "hasOwnProperty"), undefined);
  });
});

describe("cycleFlagFilterState", () => {
  it("adds, advances, then clears a chip's key across a full cycle", () => {
    const empty: FlagFilterState = {};
    const hidden = cycleFlagFilterState(empty, "done");
    assert.deepEqual(hidden, { done: "hide" });
    const only = cycleFlagFilterState(hidden, "done");
    assert.deepEqual(only, { done: "only" });
    const cleared = cycleFlagFilterState(only, "done");
    assert.deepEqual(cleared, {}, "clearing removes the key entirely (no stale entry)");
  });

  it("does not disturb other chips' states", () => {
    assert.deepEqual(cycleFlagFilterState({ a: "only", b: "hide" }, "a"), { b: "hide" });
  });

  it("cycles a prototype-shadowing key as an own property", () => {
    const next = cycleFlagFilterState({}, "toString");
    assert.deepEqual(next, { toString: "hide" });
    assert.equal(flagFilterModeOf(next, "toString"), "hide");
  });

  it("returns a new object, leaving the input untouched", () => {
    const input: FlagFilterState = { a: "hide" };
    const out = cycleFlagFilterState(input, "a");
    assert.notEqual(out, input);
    assert.deepEqual(input, { a: "hide" });
  });
});

describe("buildFlagChips", () => {
  const DONE_LABEL = "Done";

  it("emits one chip per predicate-shaped field (flag / boolean / toggle), labelled", () => {
    const schema: FlagChipSchemaView = {
      fields: {
        id: { type: "string", label: "ID" },
        status: { type: "enum", label: "Status" },
        urgent: { type: "boolean", label: "Urgent" },
        finished: { type: "toggle", label: "Finished", field: "status", onValue: "done" },
        isOpen: { type: "flag", label: "Open" },
      },
    };
    assert.deepEqual(buildFlagChips(schema, DONE_LABEL), [
      { key: "urgent", label: "Urgent" },
      { key: "finished", label: "Finished" },
      { key: "isOpen", label: "Open" },
    ]);
  });

  it("excludes non-predicate fields (string, enum) entirely", () => {
    const schema: FlagChipSchemaView = { fields: { id: { type: "string" }, status: { type: "enum" } } };
    assert.deepEqual(buildFlagChips(schema, DONE_LABEL), []);
  });

  it("falls back to the field key when a predicate field has no label", () => {
    const schema: FlagChipSchemaView = { fields: { pinned: { type: "boolean" } } };
    assert.deepEqual(buildFlagChips(schema, DONE_LABEL), [{ key: "pinned", label: "pinned" }]);
  });

  it("synthesizes a done chip for a legacy completion pair with no covering predicate", () => {
    const schema: FlagChipSchemaView = {
      fields: { status: { type: "enum", label: "Status" } },
      completionField: "status",
      completionDoneValues: ["done"],
    };
    assert.deepEqual(buildFlagChips(schema, DONE_LABEL), [{ key: "__completion", label: DONE_LABEL, synthetic: true }]);
  });

  it("does NOT synthesize a done chip when completionField names a flag (its own chip covers it)", () => {
    const schema: FlagChipSchemaView = {
      fields: { done: { type: "flag", label: "Done" } },
      completionField: "done",
    };
    assert.deepEqual(buildFlagChips(schema, DONE_LABEL), [{ key: "done", label: "Done" }]);
  });

  it("does NOT synthesize when a real field is already named __completion (no key collision)", () => {
    const schema: FlagChipSchemaView = {
      fields: { __completion: { type: "boolean", label: "Complete" }, status: { type: "enum" } },
      completionField: "status",
      completionDoneValues: ["done"],
    };
    // The boolean __completion field produces its own chip; the synthesized one is skipped.
    assert.deepEqual(buildFlagChips(schema, DONE_LABEL), [{ key: "__completion", label: "Complete" }]);
  });
});

describe("flag chip icon / colour mappings", () => {
  it("icon glyph is a filled box only for the only state", () => {
    assert.equal(flagChipIconForMode("only"), "check_box");
    assert.equal(flagChipIconForMode("hide"), "check_box_outline_blank");
    assert.equal(flagChipIconForMode(undefined), "check_box_outline_blank");
  });

  it("icon colour distinguishes hide / only / inactive", () => {
    assert.equal(flagChipIconClassForMode("hide"), "text-slate-600");
    assert.equal(flagChipIconClassForMode("only"), "text-indigo-600");
    assert.equal(flagChipIconClassForMode(undefined), "text-slate-300");
  });

  it("entry tint distinguishes hide / only / inactive", () => {
    assert.equal(flagChipClassForMode("hide"), "bg-slate-100 text-slate-700");
    assert.equal(flagChipClassForMode("only"), "bg-indigo-50 text-indigo-700");
    assert.equal(flagChipClassForMode(undefined), "text-slate-500");
  });
});
