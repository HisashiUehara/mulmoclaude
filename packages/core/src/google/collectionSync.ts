// LLM-free Google Calendar → collection sync (#2095).
//
// The whole point of #2095 is that syncing must not cost tokens: this path
// runs on the scheduler, calls the Calendar REST API directly, and writes
// records itself. No chat, no agent, no MCP round-trip.
//
// Destination is not hardcoded — a collection opts in by declaring
// `googleCalendar` in its schema, exactly the way a feed opts in by declaring
// `ingest`. There is no preset calendar collection (the standalone Calendar
// view was removed in 0.7.0); the user asks for one and the agent authors it.
import { MISSED_RUN_POLICIES, SCHEDULE_TYPES } from "@receptron/task-scheduler";
import type { SystemTaskDef } from "../scheduler/adapter.js";
import { discoverCollections } from "../collection/server/discovery.js";
import { getWorkspaceRoot } from "../collection/server/host.js";
import type { LoadedCollection } from "../collection/server/discoveredCollection.js";
import { deleteItem, writeItem } from "../collection/server/io.js";
import type { CollectionItem } from "../collection/core/schema.js";
import type { GOOGLE_CALENDAR_SOURCE_FIELDS } from "../collection/core/schemaZ.js";
import { getGoogleAccessToken } from "./auth.js";
import { canonicalCalendarId, syncCalendarEvents, type CalendarEventSummary } from "./calendar.js";
import { clearCalendarSyncToken, loadCalendarSyncToken, saveCalendarSyncToken } from "./calendarSyncStore.js";
import { log } from "./host.js";

export const GOOGLE_CALENDAR_SYNC_TASK_ID = "system:google-calendar-sync";
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const CANCELLED_STATUS = "cancelled";

export interface CalendarCollectionSyncResult {
  slug: string;
  written: number;
  removed: number;
  errors: string[];
}

/** The event fields a schema may map from — narrowed to real keys of
 *  `CalendarEventSummary` so the projection below needs no cast. */
type GoogleCalendarSourceField = (typeof GOOGLE_CALENDAR_SOURCE_FIELDS)[number];

/** Project one Google event onto the collection's own field names. The
 *  primary field always takes the event id — upsert-by-id is what keeps the
 *  sync idempotent, so it is deliberately not remappable. */
export function toCollectionRecord(event: CalendarEventSummary, map: Record<string, GoogleCalendarSourceField>, primaryKey: string): CollectionItem {
  const mapped = Object.entries(map).map(([field, source]) => [field, event[source]]);
  return { ...Object.fromEntries(mapped), [primaryKey]: event.id };
}

/** `skipped` is a benign no-op (deleting an event we never stored); `error`
 *  means the record did NOT land and the sync token must not advance past it. */
type ApplyOutcome = { kind: "written" } | { kind: "removed" } | { kind: "skipped" } | { kind: "error"; message: string };

// `writeItem` / `deleteItem` report most failures by RETURNING a non-`ok`
// kind rather than throwing (invalid id, path escape, write conflict). Ignoring
// the result would let the token advance past events that were never applied,
// and Google never resends them — silent, permanent loss (Codex review #2184).
async function applyEvent(collection: LoadedCollection, event: CalendarEventSummary, workspaceRoot: string): Promise<ApplyOutcome> {
  const { slug, dataDir, schema } = collection;
  if (event.status === CANCELLED_STATUS) {
    const deleted = await deleteItem(dataDir, event.id, { workspaceRoot, slug });
    // Cancelling an event we never stored is normal, not a failure.
    if (deleted.kind === "not-found") return { kind: "skipped" };
    return deleted.kind === "ok" ? { kind: "removed" } : { kind: "error", message: `delete ${event.id}: ${deleted.kind}` };
  }
  const record = toCollectionRecord(event, schema.googleCalendar?.map ?? {}, schema.primaryKey);
  // `slug` is load-bearing: it publishes the change so an open view updates
  // live instead of waiting for a refresh.
  const written = await writeItem(dataDir, event.id, record, { refuseOverwrite: false, workspaceRoot, slug });
  return written.kind === "ok" ? { kind: "written" } : { kind: "error", message: `write ${event.id}: ${written.kind}` };
}

async function restartFullSync(accessToken: string, calendarId: string | undefined, workspaceRoot: string) {
  await clearCalendarSyncToken(calendarId, workspaceRoot);
  return await syncCalendarEvents(accessToken, { calendarId });
}

/** Sync ONE calendar and fan its events out to every collection bound to it.
 *
 *  The fan-out is not an optimisation, it is correctness: the sync token is
 *  keyed by `calendarId`, so syncing collection-by-collection would let the
 *  first collection advance the shared token and leave every later collection
 *  on the same calendar reading an already-consumed window — silently missing
 *  those events forever. Fetch once, apply to all, then advance the token.
 *  (Codex + CodeRabbit review on #2184.) */
export async function syncCalendarGroup(
  calendarId: string | undefined,
  collections: readonly LoadedCollection[],
  workspaceRoot: string,
): Promise<CalendarCollectionSyncResult[]> {
  const accessToken = await getGoogleAccessToken();
  const storedToken = await loadCalendarSyncToken(calendarId, workspaceRoot);
  const first = await syncCalendarEvents(accessToken, { calendarId, syncToken: storedToken ?? undefined });
  const result = first.fullResyncRequired ? await restartFullSync(accessToken, calendarId, workspaceRoot) : first;

  const results: CalendarCollectionSyncResult[] = [];
  for (const collection of collections) {
    results.push(await applyEventsToCollection(collection, result.events, workspaceRoot));
  }
  // Advance the token only after every collection in the group consumed the
  // window AND every record actually landed. Google never resends a window, so
  // advancing past a failed write would lose those events for good; holding the
  // token back just replays them next run (writes are idempotent).
  const failed = results.flatMap((entry) => entry.errors);
  if (result.nextSyncToken && failed.length === 0) {
    await saveCalendarSyncToken(calendarId, result.nextSyncToken, workspaceRoot);
  } else if (failed.length > 0) {
    log.warn("google", "holding back calendar sync token after failed writes", { calendarId, failed: failed.length });
  }
  return results;
}

async function applyEventsToCollection(
  collection: LoadedCollection,
  events: readonly CalendarEventSummary[],
  workspaceRoot: string,
): Promise<CalendarCollectionSyncResult> {
  const outcomes: ApplyOutcome[] = [];
  for (const event of events) {
    outcomes.push(await applyEvent(collection, event, workspaceRoot));
  }
  return {
    slug: collection.slug,
    written: outcomes.filter((outcome) => outcome.kind === "written").length,
    removed: outcomes.filter((outcome) => outcome.kind === "removed").length,
    errors: outcomes.flatMap((outcome) => (outcome.kind === "error" ? [outcome.message] : [])),
  };
}

/** Group the declaring collections by the calendar they read, so each calendar
 *  is fetched exactly once.
 *
 *  Keyed by the CANONICAL id, not the declared one: an omitted `calendarId` and
 *  an explicit `"primary"` address the same calendar and therefore share one
 *  sync token, so grouping them apart would let one group advance the token out
 *  from under the other — the very loss this grouping exists to prevent
 *  (Codex review #2184). */
export function groupByCalendar(collections: readonly LoadedCollection[]): Map<string, LoadedCollection[]> {
  const groups = new Map<string, LoadedCollection[]>();
  for (const collection of collections) {
    const key = canonicalCalendarId(collection.schema.googleCalendar?.calendarId);
    groups.set(key, [...(groups.get(key) ?? []), collection]);
  }
  return groups;
}

/** Sync every collection that declares `googleCalendar`. Failures are isolated
 *  per calendar — one unreachable calendar (or a revoked grant) must not stop
 *  the others. */
export async function syncDueCalendarCollections(workspaceRoot: string): Promise<CalendarCollectionSyncResult[]> {
  const all = await discoverCollections({ workspaceRoot });
  const declaring = all.filter((collection) => collection.schema.googleCalendar);
  const results: CalendarCollectionSyncResult[] = [];
  for (const [calendarId, collections] of groupByCalendar(declaring)) {
    try {
      results.push(...(await syncCalendarGroup(calendarId, collections, workspaceRoot)));
    } catch (error) {
      log.warn("google", "calendar sync failed", { calendarId, error: String(error) });
      results.push(...collections.map((collection) => ({ slug: collection.slug, written: 0, removed: 0, errors: [String(error)] })));
    }
  }
  return results;
}

/** Scheduler registration, shaped like `feedRefreshTaskDef` so hosts wire it
 *  with a single line. */
export function googleCalendarSyncTaskDef(opts?: { workspaceRoot?: string; intervalMs?: number }): SystemTaskDef {
  return {
    id: GOOGLE_CALENDAR_SYNC_TASK_ID,
    name: "Google Calendar sync",
    description: "Pulls changed Google Calendar events into any collection declaring `googleCalendar`, without invoking the LLM.",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS },
    missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
    run: () => syncDueCalendarCollections(opts?.workspaceRoot ?? getWorkspaceRoot()).then(() => {}),
  };
}
