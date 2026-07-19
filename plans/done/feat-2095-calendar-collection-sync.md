# feat #2095 — LLM-free Google Calendar → collection sync

Completes #2095. The incremental client + sync-token store landed in #2182;
this wires them to a scheduled job that writes records with no LLM in the
loop, which is what makes "sync hourly" cost zero tokens.

## The target problem

There is no calendar collection to sync into, and there should not be a
preset one. The standalone Calendar view and `manageCalendar` were removed in
0.7.0 (`docs/CHANGELOG.md`); dated items are now schema-driven collections
with a `calendarField`, authored by the agent when the user asks for one.
Nothing ships a bundled `schema.json` and `data/calendar` is a dead directory
(only our dot-prefixed `.sync-state.json` lives there — `listItems` skips
dotfiles, so that placement stays safe).

So the sync cannot hardcode a destination. The collection has to name itself.

## Design — the collection declares its own source

Exactly the feeds idiom: a feed collection declares `ingest`, and
`refreshDue` picks up every collection that declares one. Here the schema
carries an optional `googleCalendar` block, and the scheduled job syncs every
collection that declares it. No config file, no settings UI, no field-name
constraints on the user's collection.

```jsonc
{
  "fields": {
    "gid":   { "type": "string",   "label": "ID",   "primary": true },
    "title": { "type": "string",   "label": "予定" },
    "on":    { "type": "datetime", "label": "開始" },
    "until": { "type": "datetime", "label": "終了" }
  },
  "displayField": "title",
  "calendarField": "on",
  "calendarEndField": "until",
  "dataPath": "data/collections/my-schedule/items",

  "googleCalendar": {
    "calendarId": "primary",
    "map": { "title": "summary", "on": "start", "until": "end" }
  }
}
```

`map` is collection field → Google event field. The **primary field always
receives `event.id`** and is not mappable: upsert-by-id is what makes the sync
idempotent, and Google's event id is the only stable key.

## Sync cycle (per declaring collection)

1. Load the stored `syncToken` for that `calendarId`.
2. `syncCalendarEvents` — no LLM, no agent, no chat.
3. Map each event through `map`; `writeItem(dataDir, event.id, record, { refuseOverwrite: false, slug })`.
   Passing `slug` is load-bearing: it publishes the change so an open view updates live.
4. `status: "cancelled"` → `deleteItem` (this is why the generic `ingest`
   retriever contract, which returns `{ items, cursor }` and cannot express a
   deletion, was the wrong vehicle).
5. Save `nextSyncToken`; on `fullResyncRequired` (410) clear and re-walk.

Failure is isolated per collection — one broken calendar must not stop the
others (mirrors `refreshDue`).

## Changes

- `packages/core/src/collection/core/schemaZ.ts` — `GoogleCalendarSyncZ`,
  optional `googleCalendar` on the schema, plus refines: `map` keys must be
  declared non-computed fields and never the primaryKey; a `dataSource`
  collection cannot declare it (read-only, same list that already bans
  `ingest`).
- `packages/core/src/google/collectionSync.ts` (new) — pure
  `toCollectionRecord`, per-collection `syncCalendarCollection`, discovery
  loop `syncDueCalendarCollections`, and `googleCalendarSyncTaskDef()`
  returning a `SystemTaskDef` (mirrors `feedRefreshTaskDef`).
- `server/index.ts` — one line in the system-task array + import.
- `packages/core/assets/helps/google-calendar-collection.md` (new) + an entry
  in `helps/index.md` — without the recipe the agent has no way to know the
  block exists, so the feature would be unreachable.
- `server/prompts/system/system.md` — drop the stale claim that
  `data/calendar/` holds calendar events; it has held nothing since 0.7.0.

## Version bump

`assets/helps/*` changed, so `@mulmoclaude/core` bumps 0.24.0 → 0.25.0 (it
ships assets to npm). All four dependent ranges move in lockstep —
`packages/mulmoclaude`, `google-plugin`, `collection-plugin` (×2). Skipping
that lockstep is exactly what stranded google-plugin on `^0.23.0` when core
went 0.24.0 and made yarn shadow the workspace build with a published tarball
(fixed in #2182).

## Tests

- `toCollectionRecord`: maps declared fields, always sets the primary from
  `event.id`, ignores unmapped fields, tolerates missing optional values.
- schema validation: accepts a valid block; rejects a `map` key that isn't a
  declared field, one that targets the primaryKey, and the block on a
  `dataSource` collection.
- sync: upserts changed events, deletes cancelled ones, persists the token,
  and re-walks on 410; one failing collection doesn't abort the rest.
