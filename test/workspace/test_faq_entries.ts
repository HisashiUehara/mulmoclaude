import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFaqEntries, entryHasPointer } from "@mulmoclaude/core/workspace-setup";

// Unit tests for the bug-report FAQ parser. The shipped file is checked
// separately (test_bug_report_faq.ts); this file pins the format rules that
// make that check meaningful.

describe("parseFaqEntries", () => {
  it("reads a heading and its three pointer kinds", () => {
    const entries = parseFaqEntries(
      ["## Voice input does nothing", "", "configKey: voiceInput", "source: packages/core/src/whisper", "help: error-recovery.md", "", "Prose."].join("\n"),
    );
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0], {
      symptom: "Voice input does nothing",
      configKeys: ["voiceInput"],
      sources: ["packages/core/src/whisper"],
      helps: ["error-recovery.md"],
    });
  });

  it("repeats a field into a list", () => {
    const entries = parseFaqEntries(["## Two helps", "help: a.md", "help: b.md"].join("\n"));
    assert.deepEqual(entries[0].helps, ["a.md", "b.md"]);
  });

  it("splits multiple entries at each heading", () => {
    const entries = parseFaqEntries(["## First", "configKey: one", "## Second", "configKey: two"].join("\n"));
    assert.deepEqual(
      entries.map((entry) => entry.symptom),
      ["First", "Second"],
    );
    assert.deepEqual(entries[1].configKeys, ["two"]);
  });

  it("ignores the format example inside a fenced block", () => {
    // The real file documents the entry shape in a fence. Parsing that block
    // would invent an entry whose pointers are placeholders, and CI would then
    // demand a config key literally named `<a key in settings.json>`.
    const entries = parseFaqEntries(["# Title", "```", "## Example symptom", "configKey: <a key>", "```", "## Real symptom", "configKey: real"].join("\n"));
    assert.deepEqual(
      entries.map((entry) => entry.symptom),
      ["Real symptom"],
    );
    assert.deepEqual(entries[0].configKeys, ["real"]);
  });

  it("drops pointer lines that appear before the first heading", () => {
    const entries = parseFaqEntries(["configKey: orphan", "## Later", "configKey: kept"].join("\n"));
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].configKeys, ["kept"]);
  });

  it("ignores prose that merely contains a colon", () => {
    const entries = parseFaqEntries(["## Symptom", "Note: this sentence is prose, not a pointer.", "configKey: real"].join("\n"));
    assert.deepEqual(entries[0].configKeys, ["real"]);
    assert.deepEqual(entries[0].sources, []);
    assert.deepEqual(entries[0].helps, []);
  });

  it("ignores a field with an empty value", () => {
    const entries = parseFaqEntries(["## Symptom", "configKey:", "configKey:   "].join("\n"));
    assert.deepEqual(entries[0].configKeys, []);
  });

  it("does not resolve a field name through the prototype chain", () => {
    // `constructor: x` would hit Object.prototype if the field table were a
    // plain object literal, and push into an undefined list.
    const entries = parseFaqEntries(["## Symptom", "constructor: boom", "toString: boom", "configKey: real"].join("\n"));
    assert.deepEqual(entries[0].configKeys, ["real"]);
  });

  it("returns no entries for empty or heading-free input", () => {
    assert.deepEqual(parseFaqEntries(""), []);
    assert.deepEqual(parseFaqEntries("# Title only\n\nSome prose.\n"), []);
  });

  it("keeps an entry that has no pointers, so the caller can reject it", () => {
    // The parser must not silently drop these — reporting them is the whole
    // point of `entryHasPointer`.
    const entries = parseFaqEntries("## Unverifiable\n\nJust prose.\n");
    assert.equal(entries.length, 1);
    assert.equal(entryHasPointer(entries[0]), false);
  });

  it("accepts an entry with any single pointer kind", () => {
    const [byConfig] = parseFaqEntries("## A\nconfigKey: k");
    const [bySource] = parseFaqEntries("## B\nsource: s");
    const [byHelp] = parseFaqEntries("## C\nhelp: h.md");
    assert.equal(entryHasPointer(byConfig), true);
    assert.equal(entryHasPointer(bySource), true);
    assert.equal(entryHasPointer(byHelp), true);
  });
});
