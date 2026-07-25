# feat(remote-host): `google.calendar.updateEvent` / `deleteEvent` (#2573)

## Background

#2572 added calendar/task update + delete to the `google` **tool**. The sweep
that produced it found the same shape missing on the **remote-host command
channel**: `server/remoteHost/handlers/googleCalendar.ts` registers only
create/read commands.

| Command | Before | After |
| --- | --- | --- |
| `google.calendar.createEvent` | ✅ | ✅ |
| `google.calendar.updateEvent` | ❌ | ✅ |
| `google.calendar.deleteEvent` | ❌ | ✅ |
| `google.calendar.listEvents` | ✅ | ✅ |
| `google.calendar.listCalendars` | ✅ | ✅ |
| `google.calendar.colors` | ✅ | ✅ |

## Why this is host-only, and what that means

#2573 records the reason it was deferred: `google.calendar.*` is called by the
**mobile app's own UI**, which is a separate codebase. Adding handlers here
does not reach a user until that app ships edit/delete UI.

That is still true. This lands the host half anyway because it is small,
symmetric, and **backward compatible**: `capabilities` is auto-derived from the
handler map, so an app that does not know these commands simply never sends
them, and one that learns them later needs no host change. The cost of landing
early is unused code; the cost of landing late is the app being blocked on us.

Do not read a green CI here as "the feature works end to end" — nothing
exercises these two commands over a real channel until the app does.

## Changes

**`server/remoteHost/handlers/googleCalendar.ts`**

- `GoogleCalendarDeps` gains `updateEvent` / `deleteEvent`, wired to core's
  `updateCalendarEvent` / `deleteCalendarEvent` (both added in #2572).
- `createGoogleCalendarUpdateEvent` — requires `eventId`; accepts `summary`,
  `start`, `end`, `description`, `calendarId`, `colorId`; returns `{ event }`.
- `createGoogleCalendarDeleteEvent` — requires `eventId`, optional
  `calendarId`; returns `{ deleted: true, eventId }`.

**`server/remoteHost/handlers/index.ts`** — registers both method names.

**`docs/remote-host.md`** — two rows in the handler table.

## Two decisions worth recording

**1. `description` needs its own param helper.** The existing `optionalString`
rejects `""`, but core's `buildEventPatch` treats `undefined` as "leave as is"
and `""` as "clear it". Routing `description` through `optionalString` would
make clearing an event's body text impossible — the request would be rejected
before it reached the patch builder. Hence `clearableString`, used for
`description` only.

**2. The "at least one field" guard is duplicated, deliberately.** The google
plugin's Zod schema has the same rule (`EDITABLE_EVENT_FIELDS` + `.refine`).
This handler cannot reuse it: the plugin validates its own args shape, while
the channel hands the handler a raw `JsonObject`. The constant is named
identically on both sides so a future reader greps one and finds the other. An
edit with no edited field PATCHes an empty body, which Google answers `200` —
so without the guard the remote reports success for a no-op.

## Testing

`test/remoteHost/test_googleCalendarHandlers.ts`, engine stubbed (no network,
no token). 48 tests total, 18 new across the two handlers:

- happy path for both, including that `deleteEvent` echoes the id (Google
  answers 204 with no body, so there is nothing else to confirm against)
- `description: ""` reaches the engine as a clear; an absent key stays
  `undefined`; and `""` still counts as an edit for the guard
- the no-edited-field rejection does not call the engine
- missing `eventId`, empty `calendarId`, offset-less `start` / `end`

**Mutation-checked** — both new rules were verified to fail when broken:
removing the at-least-one-field guard → 1 failing test; routing `description`
through `optionalString` → 2 failing tests.

## Out of scope

- Mobile app UI (separate codebase — the reason #2573 was deferred).
- `google.tasks.*` remote-host commands: none exist at all, so that is a new
  surface rather than a gap in an existing one.
