# Google Calendar sync — mirror a Google calendar into a collection

A collection can keep itself in sync with one of the user's Google calendars.
Add a `googleCalendar` block to its `schema.json` and the host pulls changed
events on a schedule and writes them as records — **without calling you**. No
tool call, no tokens spent per sync, so hourly syncing is free.

This is the only calendar mechanism: there is no calendar tool and no bundled
calendar collection. You author the schema when the user asks for one.

## Requirements

The user's Google account must be linked (`google` tool, `kind: "status"`). If
it isn't, sync silently does nothing until they link it in settings.

## The block

```jsonc
{
  "fields": {
    "gid":   { "type": "string",   "label": "ID",   "primary": true },
    "title": { "type": "string",   "label": "Event" },
    "on":    { "type": "datetime", "label": "Start" },
    "until": { "type": "datetime", "label": "End" }
  },
  "primaryKey": "gid",
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

- `calendarId` — omit for the user's primary calendar. For any other calendar,
  get the id from the `google` tool (`kind: "calendarListCalendars"`).
- `map` — **your field name → the Google event field**. Pick whatever field
  names suit the collection; the map absorbs the difference.

Mappable event fields: `summary`, `start`, `end`, `htmlLink`, `colorId`,
`status`.

## The primary field is the event id

Do **not** map the primary field. It always receives the Google event id, which
is what lets a re-sync update an existing record instead of duplicating it.
Declaring it in `map` is a schema error.

Use `datetime` (not `date`) for start/end when events have real clock times —
the calendar day view then draws each record as a proportional time block.

## What sync does

- New or edited events are written, keyed by event id (existing records are
  replaced in place).
- Events deleted in Google are **deleted** from the collection.
- Only what changed since the last run is fetched, so a big calendar stays
  cheap after the first sync.
- The first run walks the whole calendar to establish a starting point. Note
  this covers **all** dates — Google does not allow a date window together with
  incremental sync — so a calendar with years of history produces a lot of
  records on that first pass.

Records are ordinary collection records: the user can open, filter, and view
them like any other. Edits they make locally are overwritten the next time
Google reports a change to that event.

## Not for this

A `dataSource` (CSV-backed) collection is read-only and cannot declare
`googleCalendar`. Use a normal `dataPath` collection.
