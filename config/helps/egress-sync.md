# Egress sync — push collection records to an external system

Read this when the user asks to **sync a collection outward** — "push my
invoices to freee", "mirror my clients into Notion", "keep this list in a
Google Sheet". It is the write-back counterpart of feeds (which pull data IN):
a **prose pattern**, not a host feature. There is no `egress` schema block, no
sync engine, no connector registry — you are the sync engine, and this file is
the known-good way to be one.

Read `config/helps/collection-skills.md` first for the schema DSL and the
actions system; this file assumes both.

## Why this is a pattern, not host machinery

A host-side sync engine needs lifecycle triggers, debounce, retries, and —
hardest of all — a loop guard that can tell "the sync worker wrote this"
apart from "the user edited this". In this workspace that guard is
unimplementable: records are plain files with no provenance, and raw file
writes bypass any tool-layer flag. Meanwhile every judgment-shaped part of a
sync (which changes matter, how fields map to the remote system, what to do
on conflict) is exactly what you handle well and a schema can't express.

So the architecture is: **the host provides the trigger and the state
substrate; you provide the sync logic; this recipe keeps it correct.**

- Trigger — a collection-level `kind: "agent"` action (a "Sync" button), or
  a scheduled skill for periodic sync.
- State — a snapshot file kept **inside the collection's skill dir** (the
  workspace is the database; sync state is just another file).
- Transport — whatever MCP tool reaches the remote system (Notion, Google
  Sheets/Drive, GitHub, a REST API via Bash+curl…).

## The pattern in five rules

1. **Diff against a snapshot, never "sync everything".** Keep
   `data/skills/<slug>/sync/last-synced.json` — a map of record id →
   the record as of the last successful push. On each run: read current
   records (`manageCollection` getItems with `fields` — EXCLUDE computed
   fields like `derived`/`rollup` unless the remote actually wants them),
   compare against the snapshot, and push only creates / updates / deletes.
   No snapshot file yet ⇒ first run ⇒ everything is a create.
2. **Record remote identity on the record.** Add an `externalId` field
   (plain `string`) to the schema. When the remote system assigns an id
   (a Notion page id, a row number, an issue URL), write it back to the
   record with `putItems` `mode: "merge"`. That write is the ONLY write
   back into the collection a sync run may make — never round-trip remote
   field values back into local records (the local collection is the
   source of truth; pulling remote edits back is a *feed*, a different
   pattern, and mixing the two directions in one worker is how sync loops
   are born).
3. **Update the snapshot per record, after each successful push — not once
   at the end.** If the run dies halfway, the snapshot then reflects
   exactly what was pushed, and the next run resumes with the remainder
   instead of re-pushing everything (duplicates) or skipping the tail
   (silent loss).
4. **Fail partially, report honestly.** One record failing to push must not
   abort the rest. Count pushed / failed / skipped; if anything failed,
   leave it OUT of the snapshot so the next run retries it.
5. **Deletes are opt-in.** A record present in the snapshot but missing from
   the collection was deleted locally. Only propagate the delete if the
   user asked for mirror semantics; the safer default is to leave the
   remote row and note it in the run summary. (Say which behaviour you
   chose in the template.)

## Setting it up

1. Make sure the schema has `externalId` (add it via `putSchema` if
   missing): `{ "type": "string", "label": "External ID" }`.
2. Add a collection-level agent action:

```jsonc
"collectionActions": [{
  "id": "sync", "label": "Sync to Notion", "icon": "cloud_upload",
  "kind": "agent", "role": "general", "template": "templates/sync.md"
}]
```

3. Write `data/skills/<slug>/templates/sync.md` from the reference template
   below, filling in the remote system's specifics (which MCP tool, the
   field mapping, create-vs-update calls).
4. For periodic sync, schedule it instead of (or in addition to) the
   button — but start with the button: sync templates need a few visible
   runs before they've earned a schedule.

## Reference template (`templates/sync.md`)

Adapt the bracketed parts; keep the structure — every line of it exists
because of a failure mode.

```markdown
# Sync <collection title> to <remote system>

You are a background worker. Push local changes in the `<slug>` collection
to <remote system>, then stop. Nobody is watching — do not call present*
tools, do not post a summary to the chat.

## Steps

1. Read the snapshot `data/skills/<slug>/sync/last-synced.json` (id → record
   as of the last successful push). If the file does not exist, this is the
   first run: treat every record as new, and create the `sync/` directory.

2. Read the current records: `manageCollection` getItems (slug `<slug>`,
   `fields`: [<the stored fields the remote needs — no derived/rollup>]).

3. Diff current vs snapshot:
   - id not in snapshot            → CREATE remotely
   - id in both, fields differ     → UPDATE remotely (use the record's
                                     `externalId` to address the remote row)
   - id only in snapshot           → deleted locally. [Choose one:]
                                     [mirror: DELETE remotely] /
                                     [default: leave the remote row; count it]
   - id in both, fields identical  → skip

4. For each create/update, via <MCP tool>:
   - Map fields: [<local field> → <remote property>, …]
   - On CREATE, take the remote id from the response and write it back:
     `putItems` `mode: "merge"` with `{ "<primaryKey>": "<id>",
     "externalId": "<remote id>" }`. This is the only collection write
     you may make — never copy remote values into local records.
   - After EACH successful push, update `last-synced.json` with that
     record's current values (atomic-ish: rewrite the whole file each time;
     it is small). A failed push leaves that id untouched in the snapshot.

5. If a push fails, log it and continue with the remaining records. Retry
   nothing within this run.

6. When done: if anything failed, raise ONE short error so the failure bell
   fires (e.g. exit with an error message counting failures). If everything
   succeeded, just stop — silently.

## Rules

- Never write remote data back into local records (except `externalId`).
- Never push computed fields; the remote gets stored values only.
- Do not create duplicate remote rows: a record with an `externalId` is
  always an UPDATE, even if it is missing from the snapshot.
- Keep `last-synced.json` valid JSON at all times.
```

## Caveats

- **Interactively-authenticated MCP servers may be absent for hidden
  workers.** Connectors authenticated through the claude.ai UI (Notion,
  Gmail, Google Drive as claude.ai connectors) are not necessarily
  available in a hidden/headless worker session. Test the Sync button
  once; if the MCP tool is missing, either use a server-configured MCP
  (API-key based), or fall back to Bash + the remote's REST API with a
  workspace-stored token.
- **The remote is a mirror, not a second master.** If the user wants
  remote edits to flow back, that is a separate *feed* (`ingest`) reading
  the remote into a different collection — or a deliberate two-way design
  they should ask for explicitly. Do not improvise bidirectional sync
  inside a sync template.
- **`externalId` makes re-linking survivable.** Even if the snapshot is
  lost, records with an `externalId` update their existing remote rows
  instead of duplicating them; only snapshot-less records without an
  `externalId` risk a duplicate create.
