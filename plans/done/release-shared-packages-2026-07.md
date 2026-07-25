# Release shared workspace packages — 2026-07

After ~3 days of heavy refactoring, many shared workspace packages have **source
changes that were never published** — their `version` still equals npm's latest,
so nothing is version-ahead, but their source differs from what shipped. This is
the checklist to release them, in dependency-safe order.

Excludes the launcher `mulmoclaude` (published separately via `/publish-mulmoclaude`).

## Outcome — completed 2026-07-25

Every package on this checklist shipped, in three waves plus a drift-clearing pass.
The tag-based audit (`git diff <name>@<version> main -- <dir>`) now reports **51 clean,
0 drift**.

| Wave | What shipped |
|---|---|
| Foundations | `@receptron/task-scheduler@1.0.0`, `@mulmoclaude/core@1.2.1` |
| Bridges | the whole `@mulmobridge/*` suite → `1.0.0` (32 packages, incl. `protocol` / `webhook-runtime@1.0.1` / `client` / `chat-service` / `web-push` / `mock-server` and 25 channel bridges) |
| Plugins | 13 `@mulmoclaude/*` plugins (`x-plugin@1.0.0`; `@1.0.1` for the rest) |
| Follow-up | `@mulmoclaude/core@1.3.0` (#2542, #2428/#2550), `debug-plugin@1.0.1`, 6 plugins → `1.0.2`, `mulmoscript-plugin@1.1.1`, `@mulmobridge/relay@1.0.1` |

**Deliberately not shipped:** `create-mulmoclaude-plugin@0.1.0` — still absent from npm.
A first publish reserves the package name and makes `npm create mulmoclaude-plugin`
live, so it needs its own decision rather than riding along with a drift sweep.

**Still pending:** the launcher `mulmoclaude` (out of scope here, ships via
`/publish-mulmoclaude`). This matters more than the checklist implies — the published
`mulmoclaude@1.4.0` declares `@mulmoclaude/core: ^0.28.0` and 0.x ranges for every
plugin and bridge. A `0.x` caret does not float across minors, so **npm-installed users
cannot receive any of the 1.x line above** until the next launcher release. The in-tree
launcher already declares the correct 1.x ranges.

**Lesson applied:** the untagged `1.0.0` plugins that forced step 2 below to guess bump
commits are now tagged retroactively (`@mulmoclaude/debug-plugin@1.0.0` →
`f4ab4375c`, `@mulmoclaude/mulmoscript-plugin@1.1.0` → `2f6d7daee`), and every publish
in this campaign created its tag + GitHub release.

---
## How the candidates were found (reproducible)

For every non-private package under `packages/**` (except the launcher):

1. `local == npm`? (all are — nothing is version-ahead) — `npm view <name> version`.
2. **Changed since its last publish?**
   - Tagged at current version → `git diff <name>@<version> HEAD -- <dir>` (excl. `dist/`).
   - No tag for current version (the bulk `0.x → 1.0.0` plugins) → diff from the commit
     that set the current version. (Reliable only because `local == npm` there.)
3. Classify: **src/assets changed → needs release**; README/`package.json`-only → meta;
   no change → clean.

> Lesson baked into CLAUDE.md ("Tag every publish"): the untagged `1.0.0` plugins made
> step 2 fall back to guessing the bump commit. Every publish MUST create the
> `@scope/name@X.Y.Z` tag so this is a clean `git diff` next time.

## Per-package release procedure

Use the `/publish` skill (it bumps, builds, tests, publishes, **tags**, and cuts a GH
release `--latest=false`). For each package:

1. Decide the bump: **patch** for a bugfix/refactor, **minor** for a new/changed API.
2. Sweep this package's internal dep ranges to each dep's latest published version
   (CLAUDE.md "Internal dep ranges"). After publishing a dependency below, sweep its
   consumers' ranges to the new version as those consumers are released.
3. `yarn build` + `yarn test` green.
4. `/publish` → `npm publish` + tag `@scope/name@X.Y.Z` + GH release.
5. `chore(release)` commit bumps only this package's `version` (+ the launcher's dep
   RANGE for it, to keep `launcherSync.mjs` green) — never the launcher's own version.

**Ripple note:** a `0.x` caret does not float across minor (`^0.1.4` = `>=0.1.4 <0.2.0`).
So a **patch** bump of a foundation (protocol/core/…) is auto-picked up by `^0.1.x`
consumers; a **minor** bump requires updating every consumer's range (and republishing
them) — which is exactly why the order below matters.

---

## Wave 1 — foundations (publish first)

- [x] `@mulmobridge/protocol` @0.1.4 — +3 src (attachment/events/socket). Root of all bridges + chat-service.
- [x] `@mulmobridge/webhook-runtime` @1.0.0 — +1 src. Root of the webhook bridges.
- [x] `@receptron/task-scheduler` @0.1.0 — +6 src. Dep of `@mulmoclaude/core`.
- [x] `@mulmoclaude/core` @1.2.0 — +8 src (**includes the remote-host hostRunner work, #2535**). After task-scheduler. Root of all `@mulmoclaude/*-plugin`.

## Wave 2 — bridges (after protocol / webhook-runtime)

- [x] `@mulmobridge/chat-service` @0.1.7 — +4 src (after protocol)
- [x] `@mulmobridge/relay` @0.2.1 — +9 src (deps client/common are clean → effectively independent)
- [x] `@mulmobridge/irc` @0.1.1 — +2 src
- [x] `@mulmobridge/line` @0.1.1 — +2 src (after protocol + webhook-runtime)
- [x] `@mulmobridge/teams` @0.1.1 — +2 src
- [x] `@mulmobridge/bluesky` @0.1.1 — +1 src
- [x] `@mulmobridge/chatwork` @0.1.1 — +1 src
- [x] `@mulmobridge/discord` @0.1.2 — +1 src
- [x] `@mulmobridge/email` @0.1.1 — +1 src
- [x] `@mulmobridge/matrix` @0.1.1 — +1 src
- [x] `@mulmobridge/mattermost` @0.1.2 — +1 src
- [x] `@mulmobridge/nostr` @0.1.2 — +1 src
- [x] `@mulmobridge/rocketchat` @0.1.1 — +1 src
- [x] `@mulmobridge/signal` @0.1.1 — +1 src
- [x] `@mulmobridge/slack` @0.4.2 — +1 src
- [x] `@mulmobridge/twilio-sms` @0.1.1 — +1 src
- [x] `@mulmobridge/webhook` @0.1.1 — +1 src
- [x] `@mulmobridge/xmpp` @0.1.2 — +1 src
- [x] `@mulmobridge/zulip` @0.1.1 — +1 src
- [x] `@mulmobridge/google-chat` @0.1.1 — +1 src (after protocol + webhook-runtime)
- [x] `@mulmobridge/line-works` @0.1.1 — +1 src (after protocol + webhook-runtime)
- [x] `@mulmobridge/messenger` @0.1.1 — +1 src (after protocol + webhook-runtime)
- [x] `@mulmobridge/viber` @0.1.1 — +1 src (after protocol + webhook-runtime)
- [x] `@mulmobridge/whatsapp` @0.1.1 — +1 src (after protocol + webhook-runtime)

## Wave 3 — core-dependent plugins (after `@mulmoclaude/core`)

- [x] `@mulmoclaude/collection-plugin` @1.0.0 — +31 src (the #2528 refactor)
- [x] `@mulmoclaude/accounting-plugin` @1.0.0 — +21 src
- [x] `@mulmoclaude/markdown-plugin` @1.0.0 — +7 src
- [x] `@mulmoclaude/html-plugin` @1.0.0 — +4 src
- [x] `@mulmoclaude/chart-plugin` @1.0.0 — +3 src
- [x] `@mulmoclaude/google-plugin` @1.0.0 — +1 src

## Independent (no internal dep needing release — publish any time)

- [x] `@mulmoclaude/spotify-plugin` @1.0.0 — +8 src (dep common is clean)
- [x] `@mulmoclaude/x-plugin` @0.1.2 — +4 src (dep common is clean)
- [ ] `create-mulmoclaude-plugin` @0.1.0 — +4 src (**not on npm — first publish; confirm intent**)
- [x] `@mulmoclaude/bookmarks-plugin` @1.0.0 — +1 src
- [x] `@mulmoclaude/edgar-plugin` @1.0.0 — +1 src
- [x] `@mulmoclaude/email-plugin` @1.0.0 — +1 src
- [x] `@mulmoclaude/form-plugin` @1.0.0 — +1 src
- [x] `@mulmoclaude/recipe-book-plugin` @1.0.0 — +1 src

---

## Meta-only changes (README / package.json only — optional, batch)

Not source; release only if the README/dep-range update should ship now.

- [x] `@mulmobridge/cli` @0.1.3 — README + package.json
- [x] `@mulmobridge/mastodon` @0.1.2 — package.json only
- [x] `@mulmobridge/telegram` @0.1.3 — README + package.json
- [x] `@mulmobridge/mock-server` @0.1.1 — README + package.json + a test file

## Clean — no action (published == current source)

`@mulmobridge/client`, `@mulmoclaude/common`, `@mulmoclaude/markdown-utils`,
`@mulmobridge/web-push`, `@mulmoclaude/debug-plugin`, `@mulmoclaude/mulmoscript-plugin`
(published at 1.1.0 via #2543).

## After all shared packages

To actually deliver everything to npm-installed users, the launcher `mulmoclaude`
must be released last via `/publish-mulmoclaude` (out of scope for this checklist).
