// Unit tests for the stamp-validated cache behind the session-list scan
// (#2588).
//
// The dangerous failure here is a HIT that should have been a miss: the
// list would then serve a summary the filesystem has already changed,
// and the sidebar would silently stop updating. So the restamp cases
// matter more than the hit cases.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createStampedCache } from "../../server/utils/stampedCache.js";

describe("createStampedCache", () => {
  it("returns undefined for a key it has never seen", () => {
    const cache = createStampedCache<string>();
    assert.equal(cache.get("a", "1"), undefined);
  });

  it("returns the value when the stamp matches", () => {
    const cache = createStampedCache<string>();
    cache.set("a", "1", "value");
    assert.equal(cache.get("a", "1"), "value");
  });

  it("misses when the stamp has moved — the whole point", () => {
    const cache = createStampedCache<string>();
    cache.set("a", "1", "stale");
    assert.equal(cache.get("a", "2"), undefined, "a changed file must not be served from cache");
  });

  it("misses on a stamp that moved BACKWARDS too", () => {
    // mtimes can go back: a restore, a clock change, a file replaced by
    // an older copy. Equality, not ordering, is what makes that safe.
    const cache = createStampedCache<string>();
    cache.set("a", "200", "newer");
    assert.equal(cache.get("a", "100"), undefined);
  });

  it("replaces the entry on set, so the next stamp wins", () => {
    const cache = createStampedCache<string>();
    cache.set("a", "1", "first");
    cache.set("a", "2", "second");
    assert.equal(cache.get("a", "2"), "second");
    assert.equal(cache.get("a", "1"), undefined, "the superseded stamp must not resurrect");
    assert.equal(cache.size(), 1, "restamping must not grow the map");
  });

  it("keeps keys independent", () => {
    const cache = createStampedCache<string>();
    cache.set("a", "1", "A");
    cache.set("b", "1", "B");
    assert.equal(cache.get("a", "1"), "A");
    assert.equal(cache.get("b", "1"), "B");
  });

  it("can cache a falsy value without it reading as a miss", () => {
    const cache = createStampedCache<number>();
    cache.set("a", "1", 0);
    assert.equal(cache.get("a", "1"), 0);
  });
});

describe("createStampedCache — retainOnly", () => {
  it("drops keys that are gone and reports how many", () => {
    const cache = createStampedCache<string>();
    cache.set("a", "1", "A");
    cache.set("b", "1", "B");
    cache.set("c", "1", "C");

    assert.equal(cache.retainOnly(["a", "c"]), 1);
    assert.equal(cache.get("b", "1"), undefined, "a deleted session must not stay resident");
    assert.equal(cache.get("a", "1"), "A");
    assert.equal(cache.get("c", "1"), "C");
    assert.equal(cache.size(), 2);
  });

  it("accepts a Set as well as an array", () => {
    const cache = createStampedCache<string>();
    cache.set("a", "1", "A");
    cache.set("b", "1", "B");
    assert.equal(cache.retainOnly(new Set(["a"])), 1);
    assert.equal(cache.size(), 1);
  });

  it("empties the cache when nothing is live", () => {
    const cache = createStampedCache<string>();
    cache.set("a", "1", "A");
    cache.set("b", "1", "B");
    assert.equal(cache.retainOnly([]), 2);
    assert.equal(cache.size(), 0);
  });

  it("keeps everything when every key is live", () => {
    const cache = createStampedCache<string>();
    cache.set("a", "1", "A");
    cache.set("b", "1", "B");
    assert.equal(cache.retainOnly(["a", "b", "c"]), 0, "a live key the cache never saw is not a drop");
    assert.equal(cache.size(), 2);
  });
});

describe("createStampedCache — clear", () => {
  it("empties the cache", () => {
    const cache = createStampedCache<string>();
    cache.set("a", "1", "A");
    cache.set("b", "2", "B");
    cache.clear();
    assert.equal(cache.size(), 0);
    assert.equal(cache.get("a", "1"), undefined);
  });

  it("leaves the cache usable afterwards", () => {
    const cache = createStampedCache<string>();
    cache.set("a", "1", "A");
    cache.clear();
    cache.set("a", "1", "fresh");
    assert.equal(cache.get("a", "1"), "fresh");
  });
});
