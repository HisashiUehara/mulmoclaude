# refactor(#2301): finish the View.vue split — remaining child components

Closes the long-running #2301 by extracting the last four template subtrees the
prior PRs deliberately deferred. After this PR `src/plugins/manageSkills/View.vue`
is a lean orchestrator: header + component composition in the template, and the
active-skill detail state / composable wiring in the script.

## What was ALREADY done before this PR (verified against `origin/main`)

The pure-helper + composable + first-components work landed in #2456 and #2472:

- **Pure helpers in `categories.ts`** — `entryKey`, `catalogActionParams`,
  `groupEntriesByRepo`, `repoLabel`, `skillBadgeMeta`, `PRESET_SOURCE_META`,
  `buildRepoInstallBody`, `toggleInSet`, section-collapse helpers,
  `pickInitialSelection`, `categorizeSkill`.
- **Their unit tests in `test/plugins/manageSkills/test_categories.ts`** — including
  the load-bearing `entryKey` suite (external `repoId/skillFolder` vs preset slug,
  the **collision case** where two external entries share a lossy slug but differ on
  repo, and the fallback-to-slug cases). So the issue's "#1 priority: write
  entryKey's test FIRST" requirement was **already satisfied** — no test gap remained
  for any of the pure helpers (`catalogActionParams`, `groupEntriesByRepo`,
  `skillBadge`/`skillBadgeMeta`, `repoLabel` all have suites).
- **Composables** — `useSkillMarkdown`, `useSkillCatalog`, `useExternalRepos`.
- **Components** — `AddRepoModal.vue`, `CatalogDetailPane.vue`.
- **Markdown dedup** — both render paths (`View.vue` active body and
  `CatalogDetailPane.vue` preview body) already route through `useSkillMarkdown`.
  Verified: no inlined `marked`/`sanitize`/`useMermaid` combo remained.

## What this PR does (the remaining #2472 list)

Extracted the four remaining template subtrees into child SFCs. View.vue: 711 → ~320
lines; its template is now ~100 lines of composition.

| New component | Subtree it owns | Key testids it carries |
|---|---|---|
| `SkillActiveList.vue` | left Active section | `skill-section-active`, `skill-section-toggle-active`, `skill-section-count-active`, `skill-item-<name>` |
| `SkillCatalogList.vue` | left Catalog section (presets + add-repo) | `skill-section-catalog`, `skill-section-toggle-catalog`, `skill-section-count-catalog`, `skill-catalog-section-heading`, `skill-catalog-item-<entryKey>`, `skill-catalog-starred-indicator-<entryKey>`, `skill-catalog-empty`, `skill-catalog-add-repo` |
| `SkillRepoGroup.vue` | one external repo group (child of the list) | `skill-catalog-repo-<repoId>` (+ `-toggle-`/`-update-`/`-uninstall-`), `skill-catalog-item-<entryKey>`, `skill-catalog-starred-indicator-<entryKey>` |
| `SkillDetailPane.vue` | right pane active-skill detail (view + edit) | `skill-edit-btn`, `skill-cancel-btn`, `skill-save-btn`, the **flipping** `isSelectedPreset ? 'skill-unstar-btn' : 'skill-delete-btn'`, `skill-edit-description`, `skill-edit-body`, `skill-body-rendered` |

Supporting changes:

- **`index.ts`** — exported a shared `SkillDetail` interface (was inline in View.vue)
  so `SkillDetailPane.vue` and `View.vue` agree on the fetch/edit shape without
  duplicating the type.
- **`SkillDetailPane.vue` owns its own `useSkillMarkdown`** (like `CatalogDetailPane`),
  so the `ref` for mermaid post-processing sits on the `v-html` element inside the
  child. View.vue no longer needs `renderedBody`/`skillMarkdownRef`/`handleExternalLinkClick`.
- **`test/plugins/manageSkills/test_externalLinkWiring.ts`** — re-pointed the
  active-skill half of the guard from `View.vue` to `SkillDetailPane.vue` (the guard
  literally anticipates this move via its `movedMessage`). It still asserts, via the
  template AST, that `@click="handleExternalLinkClick"` sits on the SAME element as
  `v-html` — the #2471/#2493 regression it exists to catch.

### The `isSelectedPreset` flip — handled

`SkillDetailPane` receives `isSelectedPreset` (computed in View via
`isPresetActivation(detail.name, catalogPresets)`) as a prop and reproduces the exact
ternary `:data-testid="isSelectedPreset ? 'skill-unstar-btn' : 'skill-delete-btn'"`.
e2e only references `skill-delete-btn`; passing the prop keeps it from silently
flipping to `skill-unstar-btn`.

### The `entryKey` / `repoId` interpolation — same output

`SkillRepoGroup` renders one group, so the template variable is `repo.repoId` instead
of `group.repo.repoId`. The **resolved** testid strings are byte-identical
(`skill-catalog-repo-<repoId>`, `skill-catalog-item-<entryKey>`); only the
interpolation source name differs. `entryKey`/`repoLabel` are imported directly from
`categories.ts` in the children (pure module functions, not passed as props).

## Design decisions

- **Emit, not function-props** (global Vue rule): every callback is an `emit`
  (`toggle`, `select`, `update`, `uninstall`, `add-repo`, `edit`/`cancel`/`save`/`delete`,
  `star`). Pure read helpers (`entryKey`, `repoLabel`, `skillBadgeMeta`) are imported,
  not passed.
- **Repo collapse state** is passed to `SkillCatalogList` as the `repoCollapsed: Set`
  (owned by `useExternalRepos`); the list computes `!repoCollapsed.has(id)` for each
  group's `open` — a data prop, not a predicate function-prop.
- **`useSkillDetail` composable — deliberately NOT extracted.** The original issue body
  listed it as a script→composable candidate, but #2472's own "remaining" progress
  comment narrowed the close criteria to the four template components only. The
  active-skill detail STATE + fetch/edit/save/delete + stale-response guard is the
  container's orchestration and is heavily coupled to View's selection core
  (`selectedName`, `activeSkills`, `collapsedSections`, catalog reconcile). Keeping it
  in View.vue while `SkillDetailPane` stays presentational is the standard container
  pattern and avoids relocating the subtle stale-guard for no DoD gain. Noted as an
  optional future extraction.

## Verification

- **e2e (mock, no backend)**: `playwright test skills.spec.ts settings.spec.ts` —
  **36 passed** on `origin/main` baseline AND after the refactor (identical). This is
  the real proof the testids are preserved: the suite drives select/render/edit/save/
  delete + the whole external catalog (repo groups, star, add-repo, uninstall, update).
- **testid inventory**: diff of the resolved testid set (branch vs `origin/main`) is
  empty except the `group.repo.repoId`→`repo.repoId` interpolation rename (same output).
- **unit tests**: `tsx --test test/plugins/manageSkills/*.ts` — **97 pass, 0 fail**.
- **`vue-tsc --noEmit`** clean; **`tsc -p test/tsconfig.json --noEmit`** clean.
- **`yarn lint`** — 0 errors (eslint on `src/plugins/manageSkills` clean).
- **`yarn build`** — success.

## 維持必須 testids — all preserved (element type unchanged)

`skill-item-<name>` · `skill-catalog-item-<entryKey>` · `skill-catalog-starred-indicator-<entryKey>` ·
`skill-catalog-repo-<repoId>` (+ `-toggle-`/`-update-`/`-uninstall-`) · `skill-catalog-add-repo` ·
`skill-catalog-detail-pane` · `skill-catalog-detail-star-btn` · `skill-add-repo-modal`/`-url`/`-subpath`/`-submit` ·
`skill-add-repo-suggestion-<url>` · `skill-body-rendered` · `skill-edit-btn`/`-description`/`-body` ·
`skill-save-btn` · `skill-delete-btn` (+ dynamic `skill-unstar-btn`) · `skill-section-catalog`
