// Persistence for the Google Calendar incremental-sync tokens (#2095).
//
// Unlike the OAuth material in `paths.ts`, this state lives INSIDE the
// workspace. A syncToken is a claim about which records the workspace already
// holds: if it survived a workspace reset, the next incremental sync would
// report "nothing changed" against an empty calendar and stay silently empty.
// Keeping it next to the data it describes makes the two reset together.
import path from "node:path";
import { getWorkspaceRoot } from "../collection/server/host.js";
import { readJsonOrNull, writeJsonAtomicWithMode } from "./fsJson.js";
import { canonicalCalendarId } from "./calendar.js";

const SYNC_STATE_MODE = 0o600;

/** `<workspace>/data/calendar/.sync-state.json` */
export function calendarSyncStatePath(workspaceRoot?: string): string {
  return path.join(workspaceRoot ?? getWorkspaceRoot(), "data", "calendar", ".sync-state.json");
}

interface CalendarSyncState {
  /** calendarId → the `nextSyncToken` returned by that calendar's last sync. */
  tokens: Record<string, string>;
}

// Shared with the REST layer so a stored token is keyed by exactly the
// calendar the request addressed — an omitted id and an explicit "primary"
// must never end up as two different keys.
const calendarKey = canonicalCalendarId;

async function readState(workspaceRoot?: string): Promise<CalendarSyncState> {
  const stored = await readJsonOrNull<CalendarSyncState>(calendarSyncStatePath(workspaceRoot));
  return stored?.tokens ? stored : { tokens: {} };
}

// One file holds every calendar's token, so an unguarded read-modify-write
// loses updates: two calendars syncing at once both read the same snapshot and
// the later write drops the earlier one's token — silently forcing that
// calendar into a full re-walk next run. Serialising the whole cycle keeps
// them ordered. Scope is this process, which is where the concurrency comes
// from (parallel tool calls today, the scheduler fanning out over calendars
// next). Held in a const wrapper so the tail can advance without a `let`.
const writeQueue: { tail: Promise<unknown> } = { tail: Promise.resolve() };

async function updateState(mutate: (tokens: Record<string, string>) => Record<string, string>, workspaceRoot?: string): Promise<void> {
  const run = writeQueue.tail.then(async () => {
    const state = await readState(workspaceRoot);
    await writeJsonAtomicWithMode(calendarSyncStatePath(workspaceRoot), { tokens: mutate(state.tokens) }, SYNC_STATE_MODE);
  });
  // Swallow on the queue only — the caller still sees the original rejection.
  writeQueue.tail = run.catch(() => undefined);
  return await run;
}

export async function loadCalendarSyncToken(calendarId?: string, workspaceRoot?: string): Promise<string | null> {
  const state = await readState(workspaceRoot);
  return state.tokens[calendarKey(calendarId)] ?? null;
}

export async function saveCalendarSyncToken(calendarId: string | undefined, syncToken: string, workspaceRoot?: string): Promise<void> {
  const stored = calendarKey(calendarId);
  await updateState((tokens) => ({ ...tokens, [stored]: syncToken }), workspaceRoot);
}

/** Drop one calendar's token — used when Google answers 410, so the next run
 *  starts a clean full sync. */
export async function clearCalendarSyncToken(calendarId?: string, workspaceRoot?: string): Promise<void> {
  const dropped = calendarKey(calendarId);
  await updateState((tokens) => Object.fromEntries(Object.entries(tokens).filter(([key]) => key !== dropped)), workspaceRoot);
}
