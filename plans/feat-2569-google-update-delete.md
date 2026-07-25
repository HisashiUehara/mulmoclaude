# feat(google): calendar / tasks update + delete, and a help doc for the tool (#2569)

## Request

A user asked whether calendar events can be updated or deleted, and reported
that the help docs only document 2 of the tool's kinds.

Both were correct. The `google` tool could create events but never edit or
delete them, and Tasks could only be created and completed.

## Why this is small

The OAuth scope is already `https://www.googleapis.com/auth/calendar.events`
(read **and** write) — `packages/core/src/google/auth.ts`. PATCH and DELETE fall
inside it, so **no existing user has to re-link**. Same for `tasks`.

`deleteTask` was already implemented in `packages/core/src/google/tasks.ts` with
zero callers — it had simply never been exposed as a kind.

## Change

Kinds: 13 → 17.

| New kind | Engine call |
| --- | --- |
| `calendarUpdateEvent` | `updateCalendarEvent` — PATCH `/calendars/{id}/events/{eventId}` |
| `calendarDeleteEvent` | `deleteCalendarEvent` — DELETE the same URL |
| `tasksUpdate` | `updateTask` — PATCH `/lists/{id}/tasks/{taskId}` |
| `tasksDelete` | `deleteTask` (already existed, now reachable) |

PATCH, never PUT: a PUT needs the whole resource and would drop every field the
caller never read (attendees, reminders, recurrence).

## Decisions worth knowing

- **`undefined` ≠ `""`.** Omitting a field leaves it alone; passing `""` clears
  it. Collapsing them with a truthiness check would silently ignore "remove the
  description", so `buildEventPatch` / `buildTaskPatch` test `!== undefined`.
  `colorId` is the deliberate exception — Calendar rejects `""` as a palette id,
  and the arg layer refuses it anyway, so falsy means omit. Both rules are
  pinned by tests with the reason in a comment.
- **An update that changes nothing is rejected** at the arg layer. An empty
  PATCH answers 200, so the LLM would otherwise report an edit that never
  happened. `calendarId` / `taskListId` don't count as changes — they address.
- **`tasksUpdate` cannot set status.** `tasksComplete` owns that transition;
  two ways to set it would drift. Un-completing a task therefore remains
  impossible — left out deliberately, worth its own issue if anyone asks.
- **`due` can be changed but not cleared** — Google rejects `""` there. The
  limitation is recorded as a comment on `UpdateTaskInput` and in the help doc.

## Tests

- `test/services/google/test_googleCalendar.ts` — `buildEventPatch`: omitted
  fields absent, `description: ""` kept, `colorId: ""` dropped, times wrapped as
  `{dateTime}`, one-ended moves.
- `test/services/google/test_googleTasks.ts` (new) — `buildTaskPatch` plus the
  previously untested `toTaskSummary` / `toTaskListSummary` mappers.
- `packages/plugins/google-plugin/test/test_args_validation.ts` — the new kinds,
  including the "changes nothing" rejection and `description: ""` / `notes: ""`
  passing the same guard.
- `packages/plugins/google-plugin/test/test_kind_coverage.ts` (new) — the kind
  list exists twice (Zod union + the enum the LLM reads). A kind in the schema
  but not the enum is implemented and unreachable, with nothing to notice it.
  This pins both directions, and asserts introspection itself still works so a
  Zod upgrade can't turn the guard into a silent pass.

Mutation-checked: relaxing `description !== undefined` to a truthiness check
turns `test_googleCalendar.ts` red. (These tests import through the package
name, so core has to be rebuilt for a mutation to take effect — checking
without the rebuild proves nothing.)

## Docs

`packages/core/assets/helps/google.md` is new: every kind, the
timezone-offset requirement, patch semantics, the `drive.file` blind spot, and
the failure modes. Registered in `index.md`.

`google-calendar-collection.md` claimed **"there is no calendar tool"**, which is
what sent the reporter looking. Corrected to name the split — the collection
block keeps a collection fresh, the tool does one-off and write work — with links
both ways.

## Release notes

- `@mulmoclaude/core` 1.3.0 → 1.4.0 (its `assets/helps/*` changed and ships to
  npm), plus the launcher's dep range. Launcher's own `version` untouched.
- `@mulmoclaude/google-plugin` source changed after its 1.0.2 publish — drift to
  pick up on the next `/publish`, not bumped here.
