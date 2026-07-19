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

const SYNC_STATE_MODE = 0o600;
const DEFAULT_CALENDAR_KEY = "primary";

/** `<workspace>/data/calendar/.sync-state.json` */
export function calendarSyncStatePath(workspaceRoot?: string): string {
  return path.join(workspaceRoot ?? getWorkspaceRoot(), "data", "calendar", ".sync-state.json");
}

interface CalendarSyncState {
  /** calendarId → the `nextSyncToken` returned by that calendar's last sync. */
  tokens: Record<string, string>;
}

// `||` (not `??`) so an empty-string calendarId keys off "primary", matching
// the same fallback the REST layer applies when building the events URL.
const calendarKey = (calendarId: string | undefined): string => calendarId || DEFAULT_CALENDAR_KEY;

async function readState(workspaceRoot?: string): Promise<CalendarSyncState> {
  const stored = await readJsonOrNull<CalendarSyncState>(calendarSyncStatePath(workspaceRoot));
  return stored?.tokens ? stored : { tokens: {} };
}

export async function loadCalendarSyncToken(calendarId?: string, workspaceRoot?: string): Promise<string | null> {
  const state = await readState(workspaceRoot);
  return state.tokens[calendarKey(calendarId)] ?? null;
}

export async function saveCalendarSyncToken(calendarId: string | undefined, syncToken: string, workspaceRoot?: string): Promise<void> {
  const state = await readState(workspaceRoot);
  const tokens = { ...state.tokens, [calendarKey(calendarId)]: syncToken };
  await writeJsonAtomicWithMode(calendarSyncStatePath(workspaceRoot), { tokens }, SYNC_STATE_MODE);
}

/** Drop one calendar's token — used when Google answers 410, so the next run
 *  starts a clean full sync. */
export async function clearCalendarSyncToken(calendarId?: string, workspaceRoot?: string): Promise<void> {
  const state = await readState(workspaceRoot);
  const dropped = calendarKey(calendarId);
  const tokens = Object.fromEntries(Object.entries(state.tokens).filter(([key]) => key !== dropped));
  await writeJsonAtomicWithMode(calendarSyncStatePath(workspaceRoot), { tokens }, SYNC_STATE_MODE);
}
