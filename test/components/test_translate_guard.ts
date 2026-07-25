// Regression guard for #2561 — browser page translation must never
// reach the app chrome.
//
// Material Icons / Material Symbols draw glyphs from ligatures, so an
// icon element's text content IS the icon name (`send`, `lightbulb`).
// Chrome's page translation rewrites those text nodes, the ligature
// stops matching, and every icon-only control renders its name as a
// word — which is what made the UI in #2558 look like the CSS had
// never loaded.
//
// The fix is one attribute on `#app`, so the failure mode to guard is
// UI that renders OUTSIDE `#app`: a `<Teleport>` moves its content to a
// target that may not inherit the attribute, reintroducing the bug
// silently.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { findTeleportRoots } from "../helpers/teleportProbe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SCANNED_ROOTS = ["src", "packages/plugins"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".git"]);

function vueFilesUnder(dir: string, found: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) vueFilesUnder(full, found);
    } else if (entry.name.endsWith(".vue")) {
      found.push(full);
    }
  }
  return found;
}

test('#app carries translate="no" so icon ligatures survive page translation', () => {
  const html = readFileSync(path.join(REPO_ROOT, "index.html"), "utf-8");
  assert.match(
    html,
    /<div id="app"[^>]*\stranslate="no"/,
    'index.html must render `<div id="app" translate="no">`. Without it, Chrome page translation rewrites Material Icons ligature text and every icon-only control shows its name as a word (#2561).',
  );
});

test('every <Teleport> root carries translate="no" — it may render outside #app', () => {
  const files = SCANNED_ROOTS.flatMap((rel) => vueFilesUnder(path.join(REPO_ROOT, rel)));
  assert.ok(files.length > 0, "found no .vue files to scan — the scan roots are wrong");

  const unprotected = files.flatMap((file) =>
    findTeleportRoots(readFileSync(file, "utf-8"))
      .filter((root) => !root.hasTranslateNo)
      .map((root) => `${path.relative(REPO_ROOT, file)} → <${root.tag}> (to=${root.target})`),
  );

  assert.deepEqual(
    unprotected,
    [],
    `Teleported roots can render outside #app and then do not inherit its translate="no", so page translation breaks their Material Icons ligatures (#2561). A dynamic target counts — collection-plugin's record modal resolves \`:to\` to \`body\`. Add translate="no" to:\n  ${unprotected.join("\n  ")}`,
  );
});
