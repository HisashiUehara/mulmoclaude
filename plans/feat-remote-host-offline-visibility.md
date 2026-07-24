# feat: surface remote-host disconnects and auto-recover (offline visibility)

Issue: https://github.com/receptron/mulmoclaude/issues/2535
Branch: `feat/remote-host-offline-visibility`
Date: 2026-07-24

## User Prompt (ja, consolidated)

> mulmoserver からデータを入れていて、オフライン時に、オンラインにしないと動作しないけど、忘れてしまう。たぶん mulmoclaude のセッションが切れやすいのと（TTS??）、セッションが切れているときに、ユーザにわかるようにしてほしい。
>
> たぶん再起動とかじゃないかな。わからないけど、気がついたら切断されていることがよくある。瞬断で恒久オフラインはだめだね。

Clarified decisions:
- Scope: **both** the root cause (transient blip → permanent offline is unacceptable) **and** visibility.
- Notification form: **persistent banner** (like `BackendOfflineBanner`), with a reconnect action.
- Progress: create issue + implement.

## Background (how the remote host works today)

"mulmoserver" is the shared Firebase relay (`https://mulmoserver.web.app`). The desktop
connects as a **host**: the server signs in to Firebase and runs a Firestore command loop
plus a 60s presence heartbeat (`startHostRunner`). A phone opens mulmoserver, signs in with
the same Google account, sees the online host, and sends commands (e.g. `startChat`). That is
"putting data in from mulmoserver".

- Host runner lives in the **server** process: `packages/core/src/remote-host/server/hostRunner.ts`.
- Lifecycle (single runner, status): `packages/core/src/remote-host/server/lifecycle.ts`.
- Host wiring + session: `server/remoteHost/index.ts`, `server/remoteHost/session.ts`.
- Route: `server/api/routes/remoteHost.ts` (`connect`/`reconnect`/`disconnect`/`status`).
- Toolbar UI: `src/components/RemoteHostControl.vue` (the phonelink icon).
- The Firebase session blob is parked by the browser in `localStorage["remoteHost.session"]`
  so a server restart can reconnect popup-free (`reconnect` → `restore`).

## Root causes

1. **Client never polls status.** `RemoteHostControl.vue` fetches `/api/remote-host/status`
   only on mount and on popover-open. After a **server restart** or a server-side listener
   death, `status.connected` stays stale (icon stuck green) and `tryAutoReconnect` never fires
   while the tab stays open. → The user is never told, and nothing self-heals.
2. **Transient Firestore listener error → permanent offline.** `hostRunner.ts` treats every
   `onSnapshot` error as fatal (clear heartbeat, write `online:false`, `onClosed()`), with no
   re-subscribe. A brief blip permanently downs the host until a manual reconnect.

## Design

### A. Server/core — resilient listener (`hostRunner.ts`)

- Extract a **pure** classifier `classifyListenerError(error): "transient" | "fatal"`.
  - Fatal: Firestore codes `permission-denied`, `unauthenticated` (auth is bad; re-listen
    won't help) → keep today's behavior (clear heartbeat, `online:false`, `onClosed`).
  - Transient: `unavailable`, `deadline-exceeded`, `internal`, `cancelled`, `aborted`,
    `resource-exhausted` → re-subscribe with bounded exponential backoff.
  - Unknown / non-Firestore error (no recognizable code) → **fatal** (never loop forever).
- Extract a **pure** `backoffDelayMs(attempt)` (exponential, capped, e.g. 1s→30s, MAX attempts).
- Rework `startHostRunner` so the `onSnapshot` subscription can be re-established:
  - Hold mutable `unsubscribe`, a `stopped` flag, a `retryTimer`, and an `attempt` counter.
  - On transient error: schedule `subscribe()` again after `backoffDelayMs(attempt)`; keep
    presence online during retries; reset `attempt` to 0 on a healthy snapshot.
  - After MAX consecutive transient failures → treat as fatal (offline + `onClosed`).
  - The returned `stop()` and disconnect must `clearTimeout(retryTimer)` and set `stopped`
    so a scheduled retry can never resurrect a stopped runner.
- **Adversarial review (retry/replay checklist):**
  - *Double execution*: a re-subscribe replays queued docs, but `claimCommand`
    (queued→processing transaction) already makes each command run exactly once, and expired
    docs are idempotently deleted — safe. Do not bypass the claim.
  - *Abort during wait*: `stop()` clears the pending retry timer and sets `stopped`.
  - *Over-broad matching*: retry only on the explicit transient allow-list; everything else
    (incl. unknown codes) is fatal.
- Tests: extend `packages/core/test/remote-host/test_hostRunner.ts` (classifier + backoff,
  pure). Existing tests import from `src/`, so source edits are exercised directly.

### B. Client — shared remote-host state + polling + auto-reconnect

- Extract the client remote-host logic into a shared module `src/composables/useRemoteHost.ts`
  (module-scoped singleton refs + actions), mirroring the `backendReachable` pattern in
  `src/utils/api.ts`. Exposes: `status`, `error`, `busy`, `needsReconnect`, `connect()`
  (Google popup), `disconnect()`, `refreshStatus()`, `tryAutoReconnect()`, and a start/stop
  for the poll loop.
- Poll `/api/remote-host/status` every `REMOTE_HOST_POLL_MS` (new named constant; align with
  the 15s health cadence). On each poll, if a parked session blob exists (**intent**) but
  `!status.connected`, call `tryAutoReconnect()` (popup-free). Guard against overlapping
  attempts; back off after repeated failures.
- Pure helpers (own file, unit-tested): 
  - `shouldAutoReconnect({ intended, connected, inFlight })`.
  - `shouldShowOfflineBanner({ intended, connected, reconnectFailed })` — only when intended,
    disconnected, and auto-reconnect has failed (e.g. 401 blob-expired) so it doesn't flap on
    a quick restart.
- `RemoteHostControl.vue` is refactored to consume the shared module (no behavior loss).

### C. Client — persistent banner (`RemoteHostOfflineBanner.vue`)

- Same visual pattern as `BackendOfflineBanner.vue`; mounted in `src/App.vue` next to it.
- Visible only when `needsReconnect` (intended + disconnected + not silently recovering).
- Reconnect button → `tryAutoReconnect()` first; if that needs a popup (expired blob) →
  `connect()` (Google popup, user-gesture-initiated from the click).
- i18n key group `remoteHostOffline.{title,body,reconnect}` added to **all 8 locales**
  (de, en, es, fr, ja, ko, pt-BR, zh) in lockstep per `docs/i18n.md`.

### D. Docs

- Update `docs/remote-host.md` (disconnect visibility + auto-reconnect behavior).
- If a new runtime failure/diagnostic is worth the agent knowing, add a note to
  `packages/core/assets/helps/error-recovery.md` (and bump `@mulmoclaude/core` if
  `assets/helps/*` changes).

## Steps / commits

1. `docs(plan)`: this file.
2. `feat(core)`: hostRunner resilient listener + pure classifier/backoff + tests.
3. `feat`: `useRemoteHost` shared module (poll + auto-reconnect) + pure decision helpers + tests;
   refactor `RemoteHostControl.vue` onto it.
4. `feat`: `RemoteHostOfflineBanner.vue` + App.vue mount + i18n (8 locales).
5. `docs`: remote-host.md (+ error-recovery.md if applicable).
6. Gates: `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test`.
7. Open PR (Summary + Items to Confirm at top, then User Prompt, then approach).

## Items to confirm / review (for PR)

- Server-side re-subscribe correctness (double-exec, abort, error matching) — see checklist.
- Poll interval choice and reconnect backoff (avoid hammering `/reconnect` on a persistent outage).
- Banner visibility rule (must not flap during a normal quick restart).
- Whether transient network errors actually reach `onSnapshot`'s error callback in the
  Firebase Web SDK (it retries some internally) — the fix is still correct either way, but
  note the real-world trigger set.
