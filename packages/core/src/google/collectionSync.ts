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
import { syncCalendarEvents, type CalendarEventSummary } from "./calendar.js";
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

async function applyEvent(collection: LoadedCollection, event: CalendarEventSummary, workspaceRoot: string): Promise<"written" | "removed"> {
  const { slug, dataDir, schema } = collection;
  if (event.status === CANCELLED_STATUS) {
    await deleteItem(dataDir, event.id, { workspaceRoot, slug });
    return "removed";
  }
  const record = toCollectionRecord(event, schema.googleCalendar?.map ?? {}, schema.primaryKey);
  // `slug` is load-bearing: it publishes the change so an open view updates
  // live instead of waiting for a refresh.
  await writeItem(dataDir, event.id, record, { refuseOverwrite: false, workspaceRoot, slug });
  return "written";
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
  // Advance the token only after every collection in the group has consumed
  // the window, so a mid-way crash replays it instead of skipping it.
  if (result.nextSyncToken) await saveCalendarSyncToken(calendarId, result.nextSyncToken, workspaceRoot);
  return results;
}

async function applyEventsToCollection(
  collection: LoadedCollection,
  events: readonly CalendarEventSummary[],
  workspaceRoot: string,
): Promise<CalendarCollectionSyncResult> {
  const counts = { written: 0, removed: 0 };
  for (const event of events) {
    const outcome = await applyEvent(collection, event, workspaceRoot);
    counts[outcome] += 1;
  }
  return { slug: collection.slug, ...counts, errors: [] };
}

/** Group the declaring collections by the calendar they read, so each calendar
 *  is fetched exactly once. */
export function groupByCalendar(collections: readonly LoadedCollection[]): Map<string | undefined, LoadedCollection[]> {
  const groups = new Map<string | undefined, LoadedCollection[]>();
  for (const collection of collections) {
    const calendarId = collection.schema.googleCalendar?.calendarId;
    groups.set(calendarId, [...(groups.get(calendarId) ?? []), collection]);
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
