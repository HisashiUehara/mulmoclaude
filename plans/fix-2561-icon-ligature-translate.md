# fix: browser translation breaks Material Icons ligatures (#2561)

## Problem

Material Icons / Material Symbols draw glyphs from **ligatures**, so an icon
element's text content _is_ the icon name:

```vue
<span class="material-icons">send</span>
```

Browser page translation rewrites those text nodes. The ligature stops matching,
the icon name renders as a literal word, and every icon-only control inflates to
the width of that word. In #2558 this produced a UI that looked like the CSS had
never loaded — 「電球」/「送信」/「フォーラム」/「スケジュール」 in place of icons,
plus doubled nav labels from the translator's overlay spans. The centre column
(plain-text prompt pills) stayed correctly styled in the same screenshot, which
is what ruled out a CSS/build cause.

No `translate="no"` / `notranslate` existed anywhere in the tree.

## Approach considered

| Option | Reach | Cost |
| --- | --- | --- |
| A — `translate="no"` on `#app`, `translate="yes"` on content | all icons at once | ~8 files, no package republish |
| B — `translate="no"` per icon element | all icons | 119 files / 1003 sites, **844 inside published `packages/plugins/*`** → version bumps + npm publish for ~16 packages |
| C — shared `<MaterialIcon>` component | all icons | B's reach plus a refactor |

**Chose A.** The chrome is already shipped in 8 locales (`VITE_LOCALE`), so
translating it is never the desired behaviour; user/agent content opts back in.

## Change

- `index.html` — `<div id="app" translate="no">` with the reason inline.
- Body teleports render **outside** `#app` and don't inherit it, so
  `src/components/ConfirmModal.vue` and `src/components/FileTree.vue` carry their
  own `translate="no"`.
- `translate="yes"` on the agent/user content bodies: assistant reply
  (`textResponse/View.vue`, both layouts), wiki page (`WikiPageBody.vue`), skill
  body (`skill/View.vue`), skill detail + catalog panes (`manageSkills/`).

## Guard

`test/helpers/bodyTeleportProbe.ts` — pure, parses the SFC with Vue's own
compiler and reports each `<Teleport to="body">` root plus whether it carries
`translate="no"`. Looks through transparent wrappers (`Transition`, …) to the
element that actually renders. Self-checked in
`test/helpers/test_bodyTeleportProbe.ts` against the cases a source grep would
wave through: the attribute on a sibling, on the `Teleport` itself, spelled
`"yes"`, dynamic `:to`, no template block.

`test/components/test_translate_guard.ts` — asserts `#app` carries the attribute
and that no body-teleport root in `src/` or `packages/plugins/` is unprotected.
Both assertions were mutation-checked: removing the attribute from `index.html`
and from `ConfirmModal.vue` turns them red, restoring turns them green.

## Not covered by automation

Whether **Chrome** honours a nested `translate="yes"` inside a `translate="no"`
subtree. Browser translation can't be driven from Playwright, so it's recorded in
`docs/manual-testing.md` §9. If content stops being translatable, option B is the
fallback.

## Follow-up

`docs/troubleshooting.md` (PR #2562, not yet merged) tells users to turn
translation off. Once both land, that entry should note the fix shipped and keep
the workaround only for older versions.
