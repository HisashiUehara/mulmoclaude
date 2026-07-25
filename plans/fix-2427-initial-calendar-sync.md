# fix(#2427): trigger the first Google Calendar sync without waiting for the scheduler

Issue: #2427 — a collection that declares `googleCalendar` shows empty until the hourly
scheduler run (up to 1 hour), and there is no way to ask for a sync in the meantime.
Feeds have both (`refreshDue` on schedule **and** a Refresh button); calendars only had
the schedule.

## Correction to the issue's "approach A"

The issue proposed hooking collection creation at `writeAndMirrorSchema` / `refreshAfterWrite`.
That path is **edit-only** — `manageCollection`'s `putSchema` refuses an unknown slug and
tells the agent to write `data/skills/<slug>/schema.json` instead. So hooking it would
never fire on create and would fire on every schema edit.

The point where create and edit actually converge is **`POST /api/config/refresh`**:

```
agent writes data/skills/<slug>/schema.json (Write tool)
  → PostToolUse hook handleSkillBridge
  → mirrorSkillWrite → .claude/skills/<slug>/
  → POST /api/config/refresh
```

## Part (a) — first sync fires on create

**Rule: sync the calendars this workspace has never synced.** `loadCalendarSyncToken()`
returning `null` means exactly "no sync has ever landed for this calendar", which is the
state a freshly created collection is in. The rule is self-silencing: the first sync
stores a token, so the condition stops matching — which is why the trigger can sit on a
path that fires on *every* config write without needing to tell create from edit.

- `syncNewCalendarCollections()` in core: same pipeline as `syncDueCalendarCollections()`,
  with the calendar groups filtered down to the token-less ones.
- Called fire-and-forget from `/api/config/refresh` **and** from `manageCollection`'s
  post-`putSchema` refresh — the latter covers adding a `googleCalendar` block to a
  collection that already exists. Both go through one shared server helper so the rule
  has a single home.
- Fire-and-forget is required, not a shortcut: a first sync walks the entire calendar, and
  the hook runs inside the agent's tool turn.
- #2428 (merged) clears a deleted collection's token, so a re-created collection is
  token-less again and correctly gets a full walk.

Failure modes, all pre-existing and already handled: Google not linked → quiet skip
(`isGoogleLinked`, #2188); a concurrent scheduled run → both fetch, writes are idempotent
upserts by event id, and the token write is serialised by the existing queue.

## Part (b) — manual re-sync

`POST /api/collections/:slug/refresh` currently 400s unless the collection declares
`ingest`. It now also accepts a `googleCalendar` collection.

**It syncs the whole calendar group, not just the requested collection.** The sync token
is keyed by calendar: syncing one collection alone would advance the shared token and
leave every other collection on that calendar reading an already-consumed window — the
exact loss `syncCalendarGroup`'s fan-out exists to prevent. The response reports the
requested slug's own counts.

Unlike a feed refresh this never dispatches a worker, so the response carries no
`dispatched` / `chatId`; `removed` is added since a sync can delete cancelled events.

UI: the header's Refresh button is gated on `ingest || googleCalendar`, with a
calendar-specific label (`collectionsView.syncCalendar`) in all 8 locales.

## Out of scope

- **First-open auto-sync** (the feeds `maybeAutoRefreshFeed` equivalent). (a) already
  fires the sync at creation; adding a view-mount trigger too is a separate call.
- #2311 (multiple calendars per collection) — needs the cross-collection view design.
- The first sync still walks the whole calendar (Google forbids `syncToken` + a date
  window). Unchanged here; still an open spec question on #2095.

## Tests

- `unsyncedGroups` — keeps token-less calendars, drops synced ones, empty map, all-synced,
  and the injected loader is what decides (no filesystem).
- Route: a `googleCalendar` collection is accepted; a plain collection still 400s.
- Verify each new test fails when the rule is inverted (per the repo's testing policy).
