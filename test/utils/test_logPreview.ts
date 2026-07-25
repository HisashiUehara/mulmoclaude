// Unit tests for the log-payload helpers.
//
// `singleLineForLog` is a security rule, not a formatting nicety: a slug or id
// taken off `req.params` can carry CR/LF, and logged verbatim it terminates the
// line and writes attacker-chosen text that reads as its own legitimate entry.
// It was hand-rolled at eight call sites in collections.ts before being lifted
// here, so these tests pin the behaviour every one of them now depends on.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { previewSnippet, singleLineForLog } from "../../server/utils/logPreview.js";

describe("singleLineForLog", () => {
  it("passes an ordinary value through untouched", () => {
    assert.equal(singleLineForLog("todos"), "todos");
  });

  it("replaces LF with a space", () => {
    assert.equal(singleLineForLog("a\nb"), "a b");
  });

  // A lone CR is the easy one to miss: matching `\r\n` as a pair would let it
  // through, and plenty of log viewers still render it as a line break.
  it("replaces a lone CR, not just the CRLF pair", () => {
    assert.equal(singleLineForLog("a\rb"), "a b");
  });

  it("replaces both halves of a CRLF pair (two chars → two spaces)", () => {
    assert.equal(singleLineForLog("a\r\nb"), "a  b");
  });

  it("replaces every occurrence, not only the first", () => {
    assert.equal(singleLineForLog("a\nb\nc\nd"), "a b c d");
  });

  // The forged-entry shape this exists to stop.
  it("defuses a crafted log-forging payload", () => {
    const forged = "real-id\nINFO [auth] login succeeded user=admin";
    assert.equal(singleLineForLog(forged), "real-id INFO [auth] login succeeded user=admin");
    assert.ok(!singleLineForLog(forged).includes("\n"));
  });

  it("returns empty string for empty / null / undefined", () => {
    assert.equal(singleLineForLog(""), "");
    assert.equal(singleLineForLog(null), "");
    assert.equal(singleLineForLog(undefined), "");
  });

  it("leaves other whitespace alone — only line breaks are the hazard", () => {
    assert.equal(singleLineForLog("a\tb  c"), "a\tb  c");
  });

  it("does not shorten its input (truncation is previewSnippet's job)", () => {
    const long = "x".repeat(500);
    assert.equal(singleLineForLog(long), long);
  });
});

describe("previewSnippet", () => {
  it("passes a short value through untouched", () => {
    assert.equal(previewSnippet("hello"), "hello");
  });

  // Boundary: the cap is inclusive, so exactly-at-limit must NOT gain an ellipsis.
  it("leaves a value of exactly the limit uncut", () => {
    const atLimit = "x".repeat(120);
    assert.equal(previewSnippet(atLimit), atLimit);
  });

  it("truncates one char past the limit and appends the ellipsis", () => {
    const overLimit = "x".repeat(121);
    assert.equal(previewSnippet(overLimit), `${"x".repeat(120)}…`);
  });

  it("returns empty string for empty / null / undefined", () => {
    assert.equal(previewSnippet(""), "");
    assert.equal(previewSnippet(null), "");
    assert.equal(previewSnippet(undefined), "");
  });

  // Deliberate asymmetry worth pinning: previewSnippet caps length but does
  // NOT neutralise newlines, so a request-derived value needs both helpers.
  it("does not strip newlines — compose with singleLineForLog for that", () => {
    assert.equal(previewSnippet("a\nb"), "a\nb");
  });
});
