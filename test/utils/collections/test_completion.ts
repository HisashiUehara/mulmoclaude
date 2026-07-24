// Unit tests for the shared done predicate (core/completion.ts) — THE
// single implementation the notification reconciler, spawn's fallback
// predicate, and view-side completion filters all call. Pins both
// completion forms: the legacy `completionField`+`completionDoneValues`
// membership and the flag form (`completionField` names a `flag` field,
// evaluated directly against the raw record). Also covers the flag-filter
// predicates lifted out of the view: `toggleChecked`, `flagFieldValue`, and
// the `chipMatches` dispatch.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  itemIsDone,
  completionCoveredByFieldChip,
  toggleChecked,
  flagFieldValue,
  chipMatches,
  type CompletionSchemaView,
  type CompletionChipSchemaView,
  type ChipMatchSchema,
  type FlagChip,
  type CollectionItem,
  type CollectionFieldSpec as FieldSpec,
} from "@mulmoclaude/core/collection";

describe("itemIsDone — legacy completion pair", () => {
  const schema: CompletionSchemaView = {
    fields: { status: { type: "enum" } },
    completionField: "status",
    completionDoneValues: ["done", "canceled"],
  };

  it("true when the value is one of completionDoneValues", () => {
    assert.equal(itemIsDone(schema, { status: "done" }), true);
    assert.equal(itemIsDone(schema, { status: "canceled" }), true);
  });

  it("false for a non-done value or a missing field", () => {
    assert.equal(itemIsDone(schema, { status: "doing" }), false);
    assert.equal(itemIsDone(schema, {}), false);
    assert.equal(itemIsDone(schema, { status: null }), false);
  });

  it("false when the schema declares no completion tracking", () => {
    assert.equal(itemIsDone({ fields: {} }, { status: "done" }), false);
  });

  it("stringifies non-string stored values before matching", () => {
    const numeric: CompletionSchemaView = {
      fields: { phase: { type: "number" } },
      completionField: "phase",
      completionDoneValues: ["3"],
    };
    assert.equal(itemIsDone(numeric, { phase: 3 }), true);
  });
});

describe("itemIsDone — flag-form completion", () => {
  const schema: CompletionSchemaView = {
    fields: {
      status: { type: "enum" },
      isDone: { type: "flag", where: [{ field: "status", op: "in", value: ["done", "canceled"] }] },
    },
    completionField: "isDone",
  };

  it("evaluates the flag's where directly against the raw record", () => {
    assert.equal(itemIsDone(schema, { status: "done" }), true);
    assert.equal(itemIsDone(schema, { status: "doing" }), false);
  });

  it("ignores a stale stored flag value (raw records are never materialized)", () => {
    assert.equal(itemIsDone(schema, { status: "todo", isDone: true }), false);
  });

  it("supports a numeric-compare flag", () => {
    const passed: CompletionSchemaView = {
      fields: {
        score: { type: "number" },
        isPassed: { type: "flag", where: [{ field: "score", op: "gte", value: "60" }] },
      },
      completionField: "isPassed",
    };
    assert.equal(itemIsDone(passed, { score: 80 }), true);
    assert.equal(itemIsDone(passed, { score: 59 }), false);
  });
});

describe("completionCoveredByFieldChip", () => {
  it("false when there is not exactly one done value (a superset still synthesizes its own chip)", () => {
    const two: CompletionChipSchemaView = { fields: { done: { type: "boolean" } }, completionField: "done", completionDoneValues: ["true", "yes"] };
    assert.equal(completionCoveredByFieldChip(two), false);
    const none: CompletionChipSchemaView = { fields: { done: { type: "boolean" } }, completionField: "done" };
    assert.equal(completionCoveredByFieldChip(none), false);
  });

  it('true for a boolean completion field whose single done value is "true" (its own chip covers it)', () => {
    const schema: CompletionChipSchemaView = { fields: { done: { type: "boolean" } }, completionField: "done", completionDoneValues: ["true"] };
    assert.equal(completionCoveredByFieldChip(schema), true);
  });

  it('false for a boolean completion field whose single done value is not "true"', () => {
    const schema: CompletionChipSchemaView = { fields: { done: { type: "boolean" } }, completionField: "done", completionDoneValues: ["yes"] };
    assert.equal(completionCoveredByFieldChip(schema), false);
  });

  it("true when a toggle projects the completion field with a matching onValue (the todos shape)", () => {
    const schema: CompletionChipSchemaView = {
      fields: {
        status: { type: "enum" },
        doneToggle: { type: "toggle", field: "status", onValue: "done" },
      },
      completionField: "status",
      completionDoneValues: ["done"],
    };
    assert.equal(completionCoveredByFieldChip(schema), true);
  });

  it("false when a toggle projects a different field or a different onValue", () => {
    const wrongField: CompletionChipSchemaView = {
      fields: { doneToggle: { type: "toggle", field: "other", onValue: "done" } },
      completionField: "status",
      completionDoneValues: ["done"],
    };
    assert.equal(completionCoveredByFieldChip(wrongField), false);
    const wrongValue: CompletionChipSchemaView = {
      fields: { doneToggle: { type: "toggle", field: "status", onValue: "closed" } },
      completionField: "status",
      completionDoneValues: ["done"],
    };
    assert.equal(completionCoveredByFieldChip(wrongValue), false);
  });

  it("false when no boolean/toggle field expresses the completion predicate", () => {
    const schema: CompletionChipSchemaView = { fields: { status: { type: "enum" } }, completionField: "status", completionDoneValues: ["done"] };
    assert.equal(completionCoveredByFieldChip(schema), false);
  });
});

describe("toggleChecked", () => {
  const toggle: FieldSpec = { type: "toggle", label: "Done", field: "status", onValue: "done", offValue: "todo" };

  it("checked when the projected enum field equals onValue", () => {
    assert.equal(toggleChecked({ status: "done" }, toggle), true);
  });

  it("unchecked for any other projected value, including missing", () => {
    assert.equal(toggleChecked({ status: "todo" }, toggle), false);
    assert.equal(toggleChecked({}, toggle), false);
  });

  it("a non-toggle field is never checked", () => {
    const enumField: FieldSpec = { type: "enum", label: "S", values: ["done"] };
    assert.equal(toggleChecked({ status: "done" }, enumField), false);
  });
});

describe("flagFieldValue", () => {
  it("true only for the boolean literal true on the (enriched) record", () => {
    assert.equal(flagFieldValue({ urgent: true }, "urgent"), true);
    assert.equal(flagFieldValue({ urgent: false }, "urgent"), false);
  });

  it("a truthy non-boolean is NOT a set flag (strict === true)", () => {
    assert.equal(flagFieldValue({ urgent: "yes" }, "urgent"), false);
    assert.equal(flagFieldValue({ urgent: 1 }, "urgent"), false);
    assert.equal(flagFieldValue({}, "urgent"), false);
  });
});

describe("chipMatches", () => {
  const schema: ChipMatchSchema = {
    fields: {
      status: { type: "enum", label: "Status", values: ["todo", "done"] },
      doneToggle: { type: "toggle", label: "Done", field: "status", onValue: "done", offValue: "todo" },
      pinned: { type: "boolean", label: "Pinned" },
      urgent: { type: "flag", label: "Urgent", where: [{ field: "priority", op: "eq", value: "high" }] },
    },
    completionField: "status",
    completionDoneValues: ["done"],
  };
  // The enrichment the flag branch reads: materialize `urgent` from priority.
  const deriveRecord = (item: CollectionItem): Record<string, unknown> => ({ ...item, urgent: item.priority === "high" });

  it("synthetic chip dispatches to itemIsDone", () => {
    const chip: FlagChip = { key: "__completion", label: "Done", synthetic: true };
    assert.equal(chipMatches(chip, schema, { status: "done" }, deriveRecord), true);
    assert.equal(chipMatches(chip, schema, { status: "todo" }, deriveRecord), false);
  });

  it("toggle chip dispatches to the projected value, not a stored boolean", () => {
    const chip: FlagChip = { key: "doneToggle", label: "Done" };
    assert.equal(chipMatches(chip, schema, { status: "done" }, deriveRecord), true);
    assert.equal(chipMatches(chip, schema, { status: "todo" }, deriveRecord), false);
  });

  it("boolean chip reads the stored value with strict === true", () => {
    const chip: FlagChip = { key: "pinned", label: "Pinned" };
    assert.equal(chipMatches(chip, schema, { pinned: true }, deriveRecord), true);
    assert.equal(chipMatches(chip, schema, { pinned: "true" }, deriveRecord), false);
  });

  it("flag chip reads the ENRICHED record (deriveRecord), not the raw cell", () => {
    const chip: FlagChip = { key: "urgent", label: "Urgent" };
    // urgent is absent on the raw record; the enrichment computes it from priority.
    assert.equal(chipMatches(chip, schema, { priority: "high" }, deriveRecord), true);
    assert.equal(chipMatches(chip, schema, { priority: "low" }, deriveRecord), false);
  });
});
