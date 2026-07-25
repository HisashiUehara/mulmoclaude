// Self-checks for the teleport probe that the #2561 translate guard
// relies on.
//
// The probe only earns its keep if it DISCRIMINATES: a `translate="no"`
// sitting on a sibling, on the Teleport itself, or spelled `"yes"` must
// not read as "this teleported dialog is protected". These fixtures pin
// exactly the cases a source grep for `translate` would wave through —
// and the dynamic-`:to` case, which an earlier revision of this probe
// silently skipped while collection-plugin's record modal
// (`:to="teleportTarget"`, defaulting to `body`) sat unprotected.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findTeleportRoots } from "./teleportProbe.js";

const sfc = (template: string): string => `<template>\n${template}\n</template>\n`;

test("reports the teleported root and its translate attribute", () => {
  const found = findTeleportRoots(sfc(`<Teleport to="body"><div translate="no">x</div></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", target: "body", hasTranslateNo: true }]);
});

test("a teleported root without the attribute is reported as unprotected", () => {
  const found = findTeleportRoots(sfc(`<Teleport to="body"><div class="menu">x</div></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", target: "body", hasTranslateNo: false }]);
});

test("looks through transparent wrappers to the element that renders", () => {
  const found = findTeleportRoots(sfc(`<Teleport to="body"><Transition name="fade"><div translate="no">x</div></Transition></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", target: "body", hasTranslateNo: true }]);
});

test("translate on the wrapper does not count — it must be on the rendered element", () => {
  const found = findTeleportRoots(sfc(`<Teleport to="body" translate="no"><div>x</div></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", target: "body", hasTranslateNo: false }]);
});

test('translate="yes" is not translate="no"', () => {
  const found = findTeleportRoots(sfc(`<Teleport to="body"><div translate="yes">x</div></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", target: "body", hasTranslateNo: false }]);
});

test("the attribute on a sibling outside the teleport does not count", () => {
  const found = findTeleportRoots(sfc(`<div><span translate="no">safe</span><Teleport to="body"><div>x</div></Teleport></div>`));
  assert.deepEqual(found, [{ tag: "div", target: "body", hasTranslateNo: false }]);
});

test("reports every root when a teleport renders siblings", () => {
  const found = findTeleportRoots(sfc(`<Teleport to="body"><div translate="no">a</div><aside>b</aside></Teleport>`));
  assert.deepEqual(found, [
    { tag: "div", target: "body", hasTranslateNo: true },
    { tag: "aside", target: "body", hasTranslateNo: false },
  ]);
});

// A dynamic target can resolve to `body` at runtime — collection-plugin's
// record modal does exactly that. Reporting it keeps the guard honest;
// the cost of a redundant attribute is nothing.
test("a dynamic :to target is reported, not skipped", () => {
  const found = findTeleportRoots(sfc(`<Teleport :to="target"><div>x</div></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", target: "(dynamic)", hasTranslateNo: false }]);
});

test("a non-body static target is reported too — 'inside #app' is not decidable here", () => {
  const found = findTeleportRoots(sfc(`<Teleport to="#modal-layer"><div translate="no">x</div></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", target: "#modal-layer", hasTranslateNo: true }]);
});

test("templates without a teleport report nothing", () => {
  assert.deepEqual(findTeleportRoots(sfc(`<div><span>plain</span></div>`)), []);
});

test("an SFC with no template block reports nothing rather than throwing", () => {
  assert.deepEqual(findTeleportRoots(`<script setup lang="ts">const a = 1;</script>\n`), []);
});

test("a malformed SFC surfaces the parse error", () => {
  assert.throws(() => findTeleportRoots(`<template><div></template>`), /SFC parse failed/);
});
