// Unit tests for the pure slash-command chat seed
// (packages/core/src/collection/core/chatSeed.ts). Pins the exact wire format
// the collection view sends to the agent — the `id=` selector must precede the
// free-text message so the skill argument parser reads it as a flag.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { skillCommandSeed } from "@mulmoclaude/core/collection";

describe("skillCommandSeed", () => {
  it("seeds the slug command with the message when no record is addressed", () => {
    assert.equal(skillCommandSeed("mc_worklog", "add an entry"), "/mc_worklog add an entry");
  });

  it("places the id= selector before the message when a record is addressed", () => {
    assert.equal(skillCommandSeed("clients", "call them back", "jane-doe"), "/clients id=jane-doe call them back");
  });

  it("treats an empty itemId as no record (undefined path)", () => {
    // The view passes `itemId || undefined`, so "" never reaches here; guard anyway.
    assert.equal(skillCommandSeed("clients", "hi", ""), "/clients hi");
  });
});
