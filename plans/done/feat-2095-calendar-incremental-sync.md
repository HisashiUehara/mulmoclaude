# feat #2095 — Google Calendar incremental sync (syncToken)

## Scope

Foundation for token-free calendar sync: the incremental **API client**, its
**sync-state storage**, and the **tool prompt** so the agent can trigger it.

Explicitly NOT in this PR: the scheduler → collection write pipeline (the
LLM-free path that actually populates `data/calendar`). That lands next, on
top of these primitives.

## Why `syncToken` (the orthodox route)

Google Calendar v3 supports incremental sync first-class:

- Full sync returns a `nextSyncToken` on the **last** page.
- Passing `syncToken` returns **only what changed**, including deletions as
  `status: "cancelled"` — the reason this beats `updatedMin`, whose deletion
  coverage is time-limited and unreliable.
- An expired token answers **410 GONE**; the client must drop it and re-sync
  in full.

Constraint that shapes the call: `syncToken` may **not** be combined with
`timeMin` / `timeMax` / `updatedMin` / `orderBy` / `q` / `iCalUID` /
`privateExtendedProperty` / `sharedExtendedProperty`, and `showDeleted`
cannot be false. The existing `listCalendarEvents` always sends `timeMin` and
`orderBy`, so incremental sync gets its **own** function rather than a flag on
that one — existing callers (plugin tool, remote commands) stay untouched.

Consequence: a sync covers the **whole calendar**, not a time window. That is
fine — the change stream must be consumed in full to keep the token valid, but
callers are free to persist only the window they care about. Sorting moves
client-side (`orderBy` is unavailable).

## Where the sync state lives — and why it differs from the OAuth token

`google/paths.ts` deliberately keeps OAuth material **outside** the workspace
(machine-only secret; must survive workspace resets).

The sync token is the opposite: it is a claim about **which records the
workspace already holds**. If it outlived a workspace reset, the next
incremental sync would report "nothing changed" against an empty collection
and silently stay empty. So it lives **in** the workspace, next to the data it
describes:

    <workspace>/data/calendar/.sync-state.json    { "tokens": { "<calendarId>": "<token>" } }

Defined once in core (`calendarSyncStore.ts`). Not duplicated into the host's
`WORKSPACE_FILES` — core cannot import host config, and a second literal would
be a DRY violation; the host can import the core helper when the pipeline
needs it.

## Changes

- `packages/core/src/google/apiClient.ts` — `googleApiError` returns a
  `GoogleApiError` (Error subclass carrying `status`) + `isGoogleApiError`
  guard, so 410 is detectable without parsing the message. Message text is
  unchanged, so existing assertions still hold.
- `packages/core/src/google/calendar.ts` — `syncCalendarEvents(accessToken,
  { calendarId, syncToken, maxResults })` → `{ events, nextSyncToken,
  fullResyncRequired }`. Sends `singleEvents=true`, `showDeleted=true`, pages
  through `nextPageToken`, takes `nextSyncToken` from the final page, and maps
  410 to `fullResyncRequired`.
- `packages/core/src/google/calendarSyncStore.ts` (new) — load / save / clear
  the per-calendar token, atomic write, `workspaceRoot?` override for tests
  (mirrors the `home?` parameter style in `tokenStore.ts`).
- `packages/core/src/google/index.ts` — export the new surface.
- `packages/plugins/google-plugin/` — new `calendarSync` kind (args,
  dispatch, tool prompt/description). The dispatch reads the stored token,
  syncs, transparently re-runs a full sync on 410, saves the new token, and
  returns a **compact summary** (counts + a capped sample) rather than the
  whole event list, so triggering a sync does not itself burn context.

## Tests

- `syncCalendarEvents`: first run sends no `syncToken`; subsequent run sends
  it; never sends `timeMin`/`orderBy`; pagination accumulates and only the
  last page's `nextSyncToken` is kept; 410 → `fullResyncRequired`; cancelled
  events surface with `status: "cancelled"`.
- `calendarSyncStore`: round-trip, per-calendar isolation, missing file → null,
  clear.
- plugin args: `calendarSync` accepts optional `calendarId` / `fullResync`.
