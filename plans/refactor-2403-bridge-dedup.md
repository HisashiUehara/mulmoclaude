# refactor #2403 — Phase-3 dedup: bridge↔bridge and bridge↔relay clones

Issue: #2403. Phase-3 dedup target list (jscpd 186/90/80/80/73/66 tokens).

## Duplication map & chosen home

| Clone pair | Duplicated logic | Shared home | Runtime |
|---|---|---|---|
| `bridges/messenger` ↔ `relay/webhooks/messenger.ts` (186tok) | Meta Messenger payload parser (`parseOneEvent`/`extractMessages`) | `@mulmoclaude/common/meta-webhook` (new) | isomorphic (Node + Workers) |
| `bridges/whatsapp` ↔ `relay/webhooks/whatsapp.ts` (90tok) | WhatsApp Cloud payload parser (`parseOneWaMessage`/`extract`) | `@mulmoclaude/common/meta-webhook` (new) | isomorphic |
| `bridges/messenger` ↔ `bridges/whatsapp` (73tok) | Meta webhook GET `hub.challenge` verification handler + `sha256=` HMAC strip | `@mulmobridge/webhook-runtime` (existing) | Node/Express |
| `bridges/rocketchat` ↔ `bridges/zulip` (80tok ×2) | REST JSON fetch skeleton (`fetch` → `!res.ok` throw → `isRecord` narrow) | `@mulmobridge/client` (existing) | Node |
| `bridges/mastodon` ↔ `bridges/signal` (66tok) | `ws` frame → utf8 string decoder (`frameText`) | `@mulmobridge/client` (existing) | Node |

## Critical runtime-compat constraint

The relay runs on Cloudflare Workers (Web Crypto / `crypto.subtle`, `fetch`); the bridges run on Node/Express (`node:crypto`, Express). So bridge↔relay shared code MUST be runtime-agnostic:

- The Meta **HMAC signature verification** is NOT shared bridge↔relay: relay uses `crypto.subtle` (`meta.ts`), bridges use `node:crypto` (`verifyHmacSignature`). Left as-is.
- Only the **pure payload parsers** (no crypto, no I/O, `isRecord`-only) are shared bridge↔relay. `@mulmoclaude/common` is the right home: zero-dep leaf, already a dependency of both the messenger/whatsapp bridges and the relay, and it already owns `isRecord`. No Node APIs used in the new module → Workers-safe.
- `frameText` (Node `Buffer`) and `fetchJsonRecord` (I/O) are bridge↔bridge only → `@mulmobridge/client` (the shared bridge lib), NOT `@mulmoclaude/common` (kept browser/Worker-safe & pure).

## Pure-logic extraction + tests

- `@mulmoclaude/common/meta-webhook`: `extractMessengerMessages`, `extractWhatsAppMessages` (+ types). Pure. `test/test_meta_webhook.ts`.
- `@mulmobridge/webhook-runtime`: `metaVerificationResult(query, verifyToken)` pure decision fn used by the Express `registerMetaWebhookVerification(...)` I/O wrapper; `verifyMetaHmacSignature(rawBody, signature, appSecret)`. Extend `test/test_webhook-runtime.ts`.
- `@mulmobridge/client`: `frameText(data)` pure; `asJsonRecord(json)` pure narrower used by `fetchJsonRecord(url, init, errorLabel)` I/O wrapper. `test/test_frame.ts`, `test/test_http.ts`.

## Version discipline (follows the #2400 errorMessage convention)

New exports on published packages → minor bump + sweep every declared consumer range (deps/devDeps/peerDeps), root + launcher, keep `check:launcher-sync` green. NOT bumping the launcher's own `version`.

- `@mulmoclaude/common` 1.1.0 → 1.2.0 (sweep all consumers to `^1.2.0`).
- `@mulmobridge/webhook-runtime` 1.0.0 → 1.1.0 (sweep 6 bridge consumers to `^1.1.0`).
- `@mulmobridge/client` 0.1.5 → 0.2.0 (sweep all consumers to `^0.2.0`); ADD `@mulmoclaude/common: ^1.2.0` to client deps (needed for `isRecord`).
- Do NOT touch `test/scripts/mulmoclaude/fixtures/drift-drifted/**` (intentional-drift launcher-sync fixtures).

## Docs

`docs/shared-utils.md` + 1-line entries for each new helper; `docs/CHANGELOG.md` entry.

## Out of scope

Spreadsheet code (untouched). Mastodon SSRF/`request-forgery` CodeQL alert at `mastodon/src/index.ts:166` is in `fetchImageAttachment` — the only mastodon change here is extracting `frameText` (WS decode, unrelated to that fetch), so the alert surface is untouched.

## Verify

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn check:launcher-sync`, and the affected packages' `yarn test`.
