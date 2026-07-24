import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moveShortcut, moveShortcutByIdentity, type MoveDirection } from "../../src/composables/shortcutReorder.js";
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
});

describe("moveShortcutByIdentity", () => {
  it("locates the entry by (kind, slug) and moves it", () => {
    const list = [makeShortcut("a"), makeShortcut("b"), makeShortcut("c")];
    assert.deepEqual(slugs(moveShortcutByIdentity(list, "collection", "b", "up")), ["b", "a", "c"]);
    assert.deepEqual(slugs(moveShortcutByIdentity(list, "collection", "b", "down")), ["a", "c", "b"]);
  });

  it("distinguishes entries of different kinds sharing a slug", () => {
    const list = [makeShortcut("x", "collection"), makeShortcut("x", "feed")];
    const moved = moveShortcutByIdentity(list, "feed", "x", "up");
    assert.deepEqual(
      moved.map((entry) => entry.kind),
      ["feed", "collection"],
    );
  });

  it("returns the SAME reference when the slug isn't pinned (no-op)", () => {
    const list = [makeShortcut("a"), makeShortcut("b")];
    assert.equal(moveShortcutByIdentity(list, "collection", "ghost", "down"), list);
  });

  it("returns the SAME reference at an end (first up / last down)", () => {
    const list = [makeShortcut("a"), makeShortcut("b")];
    assert.equal(moveShortcutByIdentity(list, "collection", "a", "up"), list);
    assert.equal(moveShortcutByIdentity(list, "collection", "b", "down"), list);
  });

  it("keeps each entry's current metadata (reorders source objects, not a snapshot)", () => {
    const fresh = { kind: "collection" as const, slug: "a", title: "Fresh A", icon: "new_icon" };
    const list = [fresh, makeShortcut("b")];
    const moved = moveShortcutByIdentity(list, "collection", "a", "down");
    const movedA = moved.find((entry) => entry.slug === "a");
    assert.equal(movedA, fresh); // exact object, so title/icon are always current
  });

  // Codex regression: two rapid clicks must compose. The store resolves
  // each move against the list AT EXECUTION TIME, so threading the first
  // result into the second (as the serialized queue does) moves the item
  // two slots — not once. A snapshot-at-click-time design would drop the
  // second move.
  it("composes repeated moves of the same item (rapid double-click)", () => {
    const start = [makeShortcut("a"), makeShortcut("b"), makeShortcut("c")];
    const afterFirst = moveShortcutByIdentity(start, "collection", "a", "down");
    const afterSecond = moveShortcutByIdentity(afterFirst, "collection", "a", "down");
    assert.deepEqual(slugs(afterFirst), ["b", "a", "c"]);
    assert.deepEqual(slugs(afterSecond), ["b", "c", "a"]);
  });

  it("composes a sequence applied left-to-right to move an item to the end", () => {
    let list = [makeShortcut("a"), makeShortcut("b"), makeShortcut("c")];
    const directions: MoveDirection[] = ["down", "down"];
    for (const direction of directions) {
      list = moveShortcutByIdentity(list, "collection", "a", direction);
    }
    assert.deepEqual(slugs(list), ["b", "c", "a"]);
  });
});
