// First tests for the mulmoscript plugin, which shipped with none. These cover
// the pure helpers the View leans on to decide what to render, what to
// re-fetch, and whether the deck editor mounts at all — the decisions that go
// wrong silently (a beat that never renders, a movie probe that never fires)
// rather than throwing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  beatMayHaveMovie,
  getMissingCharacterKeys,
  isAllSlideDeck,
  isSameScript,
  shouldAutoRenderBeat,
  validateBeatJSON,
  type SafeParseSchema,
} from "../../../packages/plugins/mulmoscript-plugin/src/vue/helpers.ts";

const AUTO_RENDER_TYPES = ["slide", "chart", "html_tailwind"] as const;

describe("shouldAutoRenderBeat", () => {
  // Characters must be rendered first so character-using beats can reference
  // them — auto-rendering ahead of that produces beats missing their cast.
  it("refuses every beat when the script has characters", () => {
    assert.equal(shouldAutoRenderBeat({ image: { type: "slide" } }, true, AUTO_RENDER_TYPES), false);
  });

  it("accepts an auto-render type when there are no characters", () => {
    assert.equal(shouldAutoRenderBeat({ image: { type: "slide" } }, false, AUTO_RENDER_TYPES), true);
  });

  it("refuses a type outside the auto-render list", () => {
    assert.equal(shouldAutoRenderBeat({ image: { type: "imagePrompt" } }, false, AUTO_RENDER_TYPES), false);
  });

  it("refuses a beat with no image, no type, or a non-string type", () => {
    assert.equal(shouldAutoRenderBeat({}, false, AUTO_RENDER_TYPES), false);
    assert.equal(shouldAutoRenderBeat({ image: {} }, false, AUTO_RENDER_TYPES), false);
    assert.equal(shouldAutoRenderBeat({ image: { type: undefined } }, false, AUTO_RENDER_TYPES), false);
  });

  it("refuses everything when the auto-render list is empty", () => {
    assert.equal(shouldAutoRenderBeat({ image: { type: "slide" } }, false, []), false);
  });
});

describe("getMissingCharacterKeys", () => {
  it("returns keys with neither an image nor an in-flight render", () => {
    assert.deepEqual(getMissingCharacterKeys(["alice", "bob"], {}, {}), ["alice", "bob"]);
  });

  it("drops keys whose image is already loaded", () => {
    assert.deepEqual(getMissingCharacterKeys(["alice", "bob"], { alice: "data:image/png;base64,AAA" }, {}), ["bob"]);
  });

  // Re-fetching a key that is mid-render would race the render that is already
  // running and overwrite the newer result with the older one.
  it("drops keys currently rendering", () => {
    assert.deepEqual(getMissingCharacterKeys(["alice", "bob"], {}, { alice: "rendering" }), ["bob"]);
  });

  it("keeps a key whose render state is a non-rendering status", () => {
    assert.deepEqual(getMissingCharacterKeys(["alice"], {}, { alice: "failed" }), ["alice"]);
  });

  // A falsy-but-present image (empty string) means "no image yet", so the key
  // still needs fetching.
  it("treats an empty-string image as missing", () => {
    assert.deepEqual(getMissingCharacterKeys(["alice"], { alice: "" }, {}), ["alice"]);
  });

  it("returns an empty array for no keys", () => {
    assert.deepEqual(getMissingCharacterKeys([], { alice: "x" }, {}), []);
  });
});

describe("validateBeatJSON", () => {
  const acceptAll: SafeParseSchema = { safeParse: () => ({ success: true }) };
  const rejectAll: SafeParseSchema = { safeParse: () => ({ success: false }) };

  it("accepts parseable JSON the schema approves", () => {
    assert.equal(validateBeatJSON('{"text":"hi"}', acceptAll), true);
  });

  it("rejects parseable JSON the schema refuses", () => {
    assert.equal(validateBeatJSON('{"text":"hi"}', rejectAll), false);
  });

  // A parse failure must not reach the schema at all — an editor mid-keystroke
  // produces malformed JSON constantly.
  it("rejects malformed JSON without consulting the schema", () => {
    let consulted = false;
    const spy: SafeParseSchema = {
      safeParse: () => {
        consulted = true;
        return { success: true };
      },
    };
    assert.equal(validateBeatJSON("{ not json", spy), false);
    assert.equal(consulted, false);
  });

  it("rejects an empty string", () => {
    assert.equal(validateBeatJSON("", acceptAll), false);
  });

  // `JSON.parse("null")` succeeds, so the schema — not the parse — is what
  // must reject it.
  it("passes a bare null through to the schema", () => {
    assert.equal(validateBeatJSON("null", acceptAll), true);
    assert.equal(validateBeatJSON("null", rejectAll), false);
  });
});

describe("isSameScript", () => {
  it("treats structurally identical scripts as the same", () => {
    assert.equal(isSameScript({ beats: [{ text: "a" }] }, { beats: [{ text: "a" }] }), true);
  });

  it("treats a changed value as different", () => {
    assert.equal(isSameScript({ beats: [{ text: "a" }] }, { beats: [{ text: "b" }] }), false);
  });

  it("treats an added key as different", () => {
    assert.equal(isSameScript({ beats: [] }, { beats: [], title: "x" }), false);
  });

  it("treats both undefined as the same, and one undefined as different", () => {
    assert.equal(isSameScript(undefined, undefined), true);
    assert.equal(isSameScript(undefined, {}), false);
  });

  // Documented limitation: the comparison is JSON re-serialisation, so key
  // ORDER counts. A false "differ" only costs a redundant emit, which is a
  // no-op downstream — but the behaviour should be pinned, not discovered.
  it("reports reordered keys as different (serialisation-order sensitivity)", () => {
    assert.equal(isSameScript({ a: 1, b: 2 }, { b: 2, a: 1 }), false);
  });
});

describe("beatMayHaveMovie", () => {
  it("accepts a beat carrying a moviePrompt", () => {
    assert.equal(beatMayHaveMovie({ moviePrompt: "pan across the city" }), true);
  });

  it("accepts an html_tailwind beat with animation enabled", () => {
    assert.equal(beatMayHaveMovie({ image: { type: "html_tailwind", animation: true } }), true);
  });

  it("accepts an html_tailwind beat whose animation is an options object", () => {
    assert.equal(beatMayHaveMovie({ image: { type: "html_tailwind", animation: { duration: 3 } } }), true);
  });

  it("refuses html_tailwind without animation", () => {
    assert.equal(beatMayHaveMovie({ image: { type: "html_tailwind" } }), false);
    assert.equal(beatMayHaveMovie({ image: { type: "html_tailwind", animation: false } }), false);
  });

  it("refuses a non-html_tailwind beat even with animation set", () => {
    assert.equal(beatMayHaveMovie({ image: { type: "slide", animation: true } }), false);
  });

  it("refuses an empty beat and an empty moviePrompt", () => {
    assert.equal(beatMayHaveMovie({}), false);
    assert.equal(beatMayHaveMovie({ moviePrompt: "" }), false);
  });
});

describe("isAllSlideDeck", () => {
  const slide = { image: { type: "slide" } };

  it("accepts a script whose beats are all slides", () => {
    assert.equal(isAllSlideDeck({ beats: [slide, slide] }), true);
  });

  // Mixed scripts fall through to the per-beat list UI; mounting the deck
  // editor on them would hide the non-slide beats entirely.
  it("refuses a mixed script", () => {
    assert.equal(isAllSlideDeck({ beats: [slide, { image: { type: "imagePrompt" } }] }), false);
  });

  it("refuses an empty or missing beats array", () => {
    assert.equal(isAllSlideDeck({ beats: [] }), false);
    assert.equal(isAllSlideDeck({}), false);
    assert.equal(isAllSlideDeck({ beats: "not an array" }), false);
  });

  it("refuses a beat with no image or a non-record image", () => {
    assert.equal(isAllSlideDeck({ beats: [{}] }), false);
    assert.equal(isAllSlideDeck({ beats: [{ image: "slide" }] }), false);
  });

  it("refuses non-record scripts", () => {
    assert.equal(isAllSlideDeck(null), false);
    assert.equal(isAllSlideDeck(undefined), false);
    assert.equal(isAllSlideDeck("script"), false);
    assert.equal(isAllSlideDeck([slide]), false);
  });
});
