# fix(collections): deleting a collection leaves its sync state behind (#2428, #2550)

## Symptom

Both bugs look identical to the user: **recreate a collection and it stays empty.**

- **#2428** — delete a `googleCalendar` collection, recreate it on the same
  calendar, and only the delta since the delete arrives. The history never comes.
- **#2550** — delete an `ingest` collection, recreate it under the same slug, and
  the initial fetch is skipped; it sits empty until the next scheduled tick (for
  `atHour` daily, up to ~24 h).

## Root cause (one rule, two stores)

Deleting a collection removes the collection. It does not remove the state that
records **how far its syncing had got** — and that state is keyed by something
other than the collection, so it survives and gets picked up by the replacement.

Swept every store with that shape:

| state | keyed by | cleared on delete? |
|---|---|---|
| `data/calendar/.sync-state.json` tokens | calendarId | ❌ **#2428** |
| `data/ingest-state/<slug>.json` | slug | ❌ **#2550** |
| `feeds/<slug>/_state.json` | slug | ✅ `removeFeed` removes `feeds/<slug>/` |
| skillDir / dataDir / staging / sqlite | slug | ✅ `deleteTargets` |

`deleteCollection` removes exactly what `deleteTargets()` lists — staging skill
dir, `skillDir`, `dataDir`, `storageFile`. Both leaked stores live outside all
four.

For #2550 the mechanism is `engine.ts:152`: `if (!lastFetchedAt) return true`
makes a genuinely new collection fetch immediately, so inheriting a stale
`lastFetchedAt` sends it down the "wait for the interval" branch instead.

## Changes

**#2550** — `ingestStatePath(slug, workspaceRoot)` joins `deleteTargets()` (so it
passes the same containment check as every other target) and is `rm`'d with
`force: true` in `removeLocations`. Slug-exact, so there is no over-deletion
surface, and a missing file is a no-op.

Deliberately **not** archived: the archive exists to restore user data, and
restoring a stale cursor would reintroduce the bug.

**#2428** — the decision is a pure function, `orphanedCalendarId(deleted,
remaining)`, returning the canonical calendar id only when no surviving
collection reads it. `releaseOrphanedCalendarToken` wraps it with discovery + the
existing `clearCalendarSyncToken` (already used on Google's 410) and is called
from the delete route **after** the delete lands, so the check sees the
collections that survive.

Canonicalisation matters as much as the check: an omitted `calendarId` and an
explicit `"primary"` are one calendar sharing one token, so comparing the raw
values would clear a token still in use. Three tests pin that.

## Why the route and not `deleteCollection`

`collection/server/delete.ts` must not depend on the google module (uphill
import). The ingest-state cleanup has no such constraint and lives inside
`deleteCollection`, where it is safe against a future second delete path. There
is exactly one delete path today (`collections.ts` → `deleteCollection`; the MCP
`manageCollection` tool has `deleteItems`, not a collection delete).

## Failure modes considered

- `releaseOrphanedCalendarToken` never throws. The collection is already gone
  when it runs; a failed cleanup must not turn into "the collection cannot be
  deleted".
- Worst case if the check is ever wrong in the clearing direction: one full
  re-walk on the next sync. No data is lost either way — a sync token is a
  bookmark, not content.

## Known limitation (unfixed, deliberate)

`syncDueCalendarCollections` opens with a `discoverCollections()` snapshot. A
delete that lands *after* that snapshot but *before* the sync writes its token
will have its cleanup overwritten by the in-flight run, leaving the token
orphaned again. The window is narrow (syncs are hourly and short) and the
existing 410 path recovers, so closing it would need locking that neither store
has today. Recorded rather than papered over.

## Verification

- Mutation check on both fixes, **with `@mulmoclaude/core` rebuilt between runs**
  — the tests import through the package name, so they resolve to `dist/` and a
  source-only mutation reports a false green (this bit on the first attempt).
  - dropping the `rm` → 1 test red
  - forcing `stillRead = false` → 3 tests red, all three canonicalisation cases
- `yarn format` / `lint` (0 errors, 45 pre-existing warnings) / `typecheck` /
  `build` / `test` (7930 pass, 0 fail).
