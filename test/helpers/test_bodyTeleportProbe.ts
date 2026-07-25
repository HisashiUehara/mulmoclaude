// Self-checks for the body-teleport probe that the #2561 translate
// guard relies on.
//
// The probe only earns its keep if it DISCRIMINATES: a `translate="no"`
// sitting on a sibling, on the Teleport itself, or spelled `"yes"` must
// not read as "this body-level dialog is protected". These fixtures pin
// exactly the cases a source grep for `translate` would wave through.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findBodyTeleportRoots } from "./bodyTeleportProbe.js";

const sfc = (template: string): string => `<template>\n${template}\n</template>\n`;

test("reports the teleported root and its translate attribute", () => {
  const found = findBodyTeleportRoots(sfc(`<Teleport to="body"><div translate="no">x</div></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", hasTranslateNo: true }]);
});

test("a teleported root without the attribute is reported as unprotected", () => {
  const found = findBodyTeleportRoots(sfc(`<Teleport to="body"><div class="menu">x</div></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", hasTranslateNo: false }]);
});

test("looks through transparent wrappers to the element that renders", () => {
  const found = findBodyTeleportRoots(sfc(`<Teleport to="body"><Transition name="fade"><div translate="no">x</div></Transition></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", hasTranslateNo: true }]);
});

test("translate on the wrapper does not count — it must be on the rendered element", () => {
  const found = findBodyTeleportRoots(sfc(`<Teleport to="body" translate="no"><div>x</div></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", hasTranslateNo: false }]);
});

test('translate="yes" is not translate="no"', () => {
  const found = findBodyTeleportRoots(sfc(`<Teleport to="body"><div translate="yes">x</div></Teleport>`));
  assert.deepEqual(found, [{ tag: "div", hasTranslateNo: false }]);
});

test("the attribute on a sibling outside the teleport does not count", () => {
  const found = findBodyTeleportRoots(sfc(`<div><span translate="no">safe</span><Teleport to="body"><div>x</div></Teleport></div>`));
  assert.deepEqual(found, [{ tag: "div", hasTranslateNo: false }]);
});

test("reports every root when a teleport renders siblings", () => {
  const found = findBodyTeleportRoots(sfc(`<Teleport to="body"><div translate="no">a</div><aside>b</aside></Teleport>`));
  assert.deepEqual(found, [
    { tag: "div", hasTranslateNo: true },
    { tag: "aside", hasTranslateNo: false },
  ]);
});

test("teleports to a target other than body are ignored — they stay inside #app", () => {
  assert.deepEqual(findBodyTeleportRoots(sfc(`<Teleport to="#modal-layer"><div>x</div></Teleport>`)), []);
});

test("a dynamic :to binding is not guessed at", () => {
  assert.deepEqual(findBodyTeleportRoots(sfc(`<Teleport :to="target"><div>x</div></Teleport>`)), []);
});

test("templates without a body teleport report nothing", () => {
  assert.deepEqual(findBodyTeleportRoots(sfc(`<div><span>plain</span></div>`)), []);
});

test("an SFC with no template block reports nothing rather than throwing", () => {
  assert.deepEqual(findBodyTeleportRoots(`<script setup lang="ts">const a = 1;</script>\n`), []);
});

test("a malformed SFC surfaces the parse error", () => {
  assert.throws(() => findBodyTeleportRoots(`<template><div></template>`), /SFC parse failed/);
});
