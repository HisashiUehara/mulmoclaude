import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moveShortcut, isSamePermutation, isSameOrder } from "../../src/composables/shortcutReorder.js";
import type { Shortcut } from "../../src/types/shortcuts.js";

function makeShortcut(slug: string, kind: Shortcut["kind"] = "collection"): Shortcut {
  return { kind, slug, title: slug, icon: "bookmark" };
}

const slugs = (list: Shortcut[]): string[] => list.map((entry) => entry.slug);

describe("moveShortcut", () => {
  it("moves an item up one slot", () => {
    const list = [makeShortcut("a"), makeShortcut("b"), makeShortcut("c")];
    assert.deepEqual(slugs(moveShortcut(list, 1, "up")), ["b", "a", "c"]);
  });

  it("moves an item down one slot", () => {
    const list = [makeShortcut("a"), makeShortcut("b"), makeShortcut("c")];
    assert.deepEqual(slugs(moveShortcut(list, 1, "down")), ["a", "c", "b"]);
  });

  it("returns the SAME reference when moving the first item up (no-op)", () => {
    const list = [makeShortcut("a"), makeShortcut("b")];
    assert.equal(moveShortcut(list, 0, "up"), list);
  });

  it("returns the SAME reference when moving the last item down (no-op)", () => {
    const list = [makeShortcut("a"), makeShortcut("b")];
    assert.equal(moveShortcut(list, 1, "down"), list);
  });

  it("returns the SAME reference for an out-of-range index", () => {
    const list = [makeShortcut("a"), makeShortcut("b")];
    assert.equal(moveShortcut(list, 5, "up"), list);
    assert.equal(moveShortcut(list, -1, "down"), list);
  });

  it("never mutates the input array", () => {
    const list = [makeShortcut("a"), makeShortcut("b"), makeShortcut("c")];
    const before = slugs(list);
    moveShortcut(list, 2, "up");
    assert.deepEqual(slugs(list), before);
  });

  it("handles a single-element list as a no-op both directions", () => {
    const list = [makeShortcut("only")];
    assert.equal(moveShortcut(list, 0, "up"), list);
    assert.equal(moveShortcut(list, 0, "down"), list);
  });

  it("distinguishes items of different kinds sharing a slug", () => {
    const list = [makeShortcut("x", "collection"), makeShortcut("x", "feed")];
    const moved = moveShortcut(list, 1, "up");
    assert.deepEqual(
      moved.map((entry) => entry.kind),
      ["feed", "collection"],
    );
  });
});

describe("isSamePermutation", () => {
  it("is true for the same members in a different order", () => {
    assert.equal(isSamePermutation([makeShortcut("a"), makeShortcut("b")], [makeShortcut("b"), makeShortcut("a")]), true);
  });

  it("is false when a member is dropped", () => {
    assert.equal(isSamePermutation([makeShortcut("a"), makeShortcut("b")], [makeShortcut("a")]), false);
  });

  it("is false when a foreign member is injected", () => {
    assert.equal(isSamePermutation([makeShortcut("a"), makeShortcut("b")], [makeShortcut("a"), makeShortcut("c")]), false);
  });

  it("treats (kind, slug) as the identity — same slug, different kind is not the same member", () => {
    assert.equal(isSamePermutation([makeShortcut("x", "collection")], [makeShortcut("x", "feed")]), false);
  });

  it("is true for two empty lists", () => {
    assert.equal(isSamePermutation([], []), true);
  });
});

describe("isSameOrder", () => {
  it("is true only for the identical sequence", () => {
    assert.equal(isSameOrder([makeShortcut("a"), makeShortcut("b")], [makeShortcut("a"), makeShortcut("b")]), true);
    assert.equal(isSameOrder([makeShortcut("a"), makeShortcut("b")], [makeShortcut("b"), makeShortcut("a")]), false);
  });

  it("is false for differing lengths", () => {
    assert.equal(isSameOrder([makeShortcut("a")], [makeShortcut("a"), makeShortcut("b")]), false);
  });
});
