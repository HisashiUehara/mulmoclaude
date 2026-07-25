# docs: setup troubleshooting guide (#2558)

## Request

Issue #2558 (from an external contributor, ex-PR #2552) proposes a Japanese troubleshooting
doc for "the UI at `:5173` is completely unstyled right after `git clone && yarn dev`"
on Windows 11 / Node 24 / yarn 1.22. Their stated root cause: plugin packages unbuilt →
`dist/style.css` / `dist/vue.js` 404 → fix with `yarn dev:full-build`.

## What was verified before writing

Reading the actual code / the reporter's screenshots changed the diagnosis:

1. **The screenshot's brokenness is browser auto-translation, not the plugin build.**
   The "broken" screenshot shows icon-only buttons rendering the words 「星」「電球」「送信」
   and doubled nav text. Material Icons / Material Symbols draw via **ligatures** — the
   element's text content *is* the icon name (`send`, `star`). Chrome / Google Translate
   rewrites those text nodes, the ligature stops matching, and every icon-only control
   inflates to a word of text. The centre column (plain text prompt pills) is styled
   correctly in the same screenshot, which rules out "CSS never loaded".
   `grep` confirms no `translate="no"` / `notranslate` anywhere in `src/` or `index.html`.

2. **`yarn dev` already builds workspace packages on cold start.** `scripts/dev-build-if-needed.mjs`
   rebuilds when `<pkg>/dist` is missing. So "you must run `dev:full-build` after a clone"
   is not true as a general rule — but the gate is **mtime-based**, so a *partial* `dist/`
   (interrupted or failed build) reads as fresh and the rebuild is silently skipped. That
   is the real trap, and `yarn dev:full-build` is the right escape hatch. `dev:full-build`
   is currently documented nowhere.

3. The remaining pitfalls in the proposal check out: OneDrive dehydrating `node_modules\.bin`,
   confusing the workspace (`~/mulmoclaude`, no `package.json`) with the source clone, and the
   per-start bearer token causing a 401 in a stale tab (`docs/developer.md#auth`).

4. Boot WARNs were re-checked against `server/system/announceOptionalDeps.ts` on latest `main`
   — whisper is now gated behind `voiceInput.enabled` (#2555), so the proposal's table was
   already stale on that row.

## Plan

- Add `docs/troubleshooting.md` (English, source of truth) covering: auto-translation breaking
  icon ligatures, `dist/*` 404s (runtime-plugin vs workspace-package, and the mtime-gate trap),
  OneDrive on Windows, workspace-vs-source confusion, 401 after restart, and the boot WARNs
  that are not errors.
- Link it from `docs/README.md` (Developers table).
- Link it from all 8 `README*.md`: one line under "Run from source" + a row in the
  documentation table, translated per locale (i18n lockstep).

## Out of scope (follow-up)

Making the UI translation-proof is a code change, not a doc change: icon spans need
`translate="no"` (or a shared `<MaterialIcon>` component that sets it). Filed as **#2561**
— the app already ships 8 locales, so page translation should never be needed, but users
will still trigger it accidentally.
