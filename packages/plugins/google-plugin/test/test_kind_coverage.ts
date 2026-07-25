// The `kind` list exists twice: as the Zod discriminated union the dispatch
// validates against (`args.ts`) and as the enum the LLM reads (`definition.ts`).
// They drift silently in the direction that matters most — a kind added to the
// schema but not the enum is implemented and unreachable, with nothing to
// notice it. This pins them together.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GoogleArgs } from "../src/args";
import { TOOL_DEFINITION } from "../src/definition";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The `kind` literal of one union member.
 *
 *  A Zod discriminated union has no public API for enumerating its members, so
 *  this reads `def.options` and each member's shape. `.refine()`d members
 *  (the update kinds) still expose `shape`. If a Zod upgrade changes either,
 *  this returns nothing and the coverage assertions below fail loudly — which
 *  is the point: a guard that quietly degrades to an empty list is worse than
 *  no guard.
 */
const literalKindOf = (option: unknown): string | null => {
  if (!isRecord(option)) return null;
  const shape = isRecord(option.shape) ? option.shape : null;
  const kind = shape !== null && isRecord(shape.kind) ? shape.kind : null;
  return kind !== null && typeof kind.value === "string" ? kind.value : null;
};

const schemaKinds = (): string[] => {
  const def: unknown = isRecord(GoogleArgs) ? GoogleArgs.def : null;
  const options = isRecord(def) && Array.isArray(def.options) ? def.options : [];
  return options.map(literalKindOf).filter((kind): kind is string => kind !== null);
};

const definitionKinds = (): string[] => {
  const kind = TOOL_DEFINITION.parameters.properties.kind;
  return [...kind.enum];
};

describe("google tool kind coverage", () => {
  it("can read the kinds out of the schema at all", () => {
    // Guards the guard: without this, a Zod internals change turns every
    // assertion below into a comparison of two empty-ish sets that passes.
    assert.ok(schemaKinds().length > 5, `schema introspection returned ${schemaKinds().length} kinds — Zod's union shape changed, fix literalKindOf()`);
  });

  it("advertises every kind the schema accepts", () => {
    const missing = schemaKinds().filter((kind) => !definitionKinds().includes(kind));
    assert.deepEqual(missing, [], `implemented but not in TOOL_DEFINITION's enum, so the LLM can never call them: ${missing.join(", ")}`);
  });

  it("accepts every kind it advertises", () => {
    const missing = definitionKinds().filter((kind) => !schemaKinds().includes(kind));
    assert.deepEqual(missing, [], `advertised to the LLM but rejected by GoogleArgs: ${missing.join(", ")}`);
  });

  it("describes every kind in the prose the LLM reads", () => {
    const undocumented = definitionKinds().filter((kind) => !TOOL_DEFINITION.description.includes(`\`${kind}\``));
    assert.deepEqual(undocumented, [], `in the enum but never explained in the description: ${undocumented.join(", ")}`);
  });

  it("lists no kind twice", () => {
    assert.equal(new Set(definitionKinds()).size, definitionKinds().length);
  });
});
