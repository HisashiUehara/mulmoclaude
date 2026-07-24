// Parity tests: the hand-rolled renderer scanner must accept exactly the
// same `[[...]]` bodies as WIKI_LINK_PATTERN. If the renderer accepts a
// link the pattern rejects, that link renders clickable but is invisible
// to the graph / backlinks / lint — and a newline-bearing slug could reach
// the URL.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderWikiLinks } from "../../src/wiki/render.ts";
import { WIKI_LINK_PATTERN, WIKI_LINK_MAX_LEN } from "../../src/wiki/link.ts";

const hasLink = (html: string): boolean => html.includes('class="wiki-link"');
const patternMatches = (body: string): boolean => {
  WIKI_LINK_PATTERN.lastIndex = 0;
  return WIKI_LINK_PATTERN.test(`[[${body}]]`);
};

describe("renderWikiLinks — basic", () => {
  it("renders a plain link", () => {
    assert.ok(hasLink(renderWikiLinks("see [[Home]]")));
  });

  it("renders a target|display link", () => {
    const html = renderWikiLinks("[[home|Home Page]]");
    assert.ok(html.includes('data-page="home"'));
    assert.ok(html.includes(">Home Page<"));
  });

  it("leaves a zero-length body literal", () => {
    assert.ok(!hasLink(renderWikiLinks("[[]]")));
  });
});

describe("renderWikiLinks — parity with WIKI_LINK_PATTERN", () => {
  // Regression: a newline inside the brackets used to render clickable but
  // was invisible to the pattern-based graph/backlinks/lint.
  it("does NOT render a link whose body contains a newline", () => {
    for (const body of ["foo\nbar", "foo\r\nbar", "a\rb"]) {
      assert.equal(patternMatches(body), false, `pattern should reject ${JSON.stringify(body)}`);
      assert.equal(hasLink(renderWikiLinks(`[[${body}]]`)), false, `renderer should reject ${JSON.stringify(body)}`);
    }
  });

  it("renders a body exactly at the length cap", () => {
    const body = "a".repeat(WIKI_LINK_MAX_LEN);
    assert.equal(patternMatches(body), true);
    assert.equal(hasLink(renderWikiLinks(`[[${body}]]`)), true);
  });

  // Regression: an over-length body used to render clickable but was
  // invisible to the pattern.
  it("does NOT render a body one char over the cap", () => {
    const body = "a".repeat(WIKI_LINK_MAX_LEN + 1);
    assert.equal(patternMatches(body), false);
    assert.equal(hasLink(renderWikiLinks(`[[${body}]]`)), false);
  });

  it("still rejects a bare ] in the body (both agree)", () => {
    assert.equal(patternMatches("a]b"), false);
    assert.equal(hasLink(renderWikiLinks("[[a]b]]")), false);
  });

  // Regression: a `[` inside the brackets used to render clickable but the
  // pattern's `[^\][\r\n]` body class rejects `[`, so the link was invisible
  // to the pattern-based graph/backlinks/lint.
  it("does NOT render a link whose body contains a [", () => {
    assert.equal(patternMatches("a[b"), false);
    assert.equal(hasLink(renderWikiLinks("[[a[b]]")), false);
  });

  // renderer-accepts iff pattern-matches, across the tricky boundary bodies.
  it("agrees with WIKI_LINK_PATTERN on every body (accept iff match)", () => {
    const bodies = [
      "Home", // normal
      "home|Home Page", // piped
      "", // empty
      "a[b", // inner [
      "[", // lone [
      "a[b[c", // multiple [
      "a]b", // inner ]
      "foo\nbar", // newline
      "a\rb", // carriage return
      "foo\r\nbar", // CRLF
      "a".repeat(WIKI_LINK_MAX_LEN), // at cap
      "a".repeat(WIKI_LINK_MAX_LEN + 1), // over cap
    ];
    for (const body of bodies) {
      assert.equal(hasLink(renderWikiLinks(`[[${body}]]`)), patternMatches(body), `renderer/pattern parity broke on ${JSON.stringify(body)}`);
    }
  });
});
