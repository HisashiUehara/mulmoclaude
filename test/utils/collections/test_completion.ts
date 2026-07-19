// Unit tests for the shared done predicate (core/completion.ts) — THE
// single implementation the notification reconciler, spawn's fallback
// predicate, and view-side completion filters all call. Pins both
// completion forms: the legacy `completionField`+`completionDoneValues`
// membership and the flag form (`completionField` names a `flag` field,
// evaluated directly against the raw record).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { itemIsDone, type CompletionSchemaView } from "@mulmoclaude/core/collection";

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
