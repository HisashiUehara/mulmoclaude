// First sync for a freshly declared `googleCalendar` collection (#2427).
//
// Create and edit both converge on the config refresh (`/api/config/refresh`
// for a Write-tool create, `manageCollection`'s post-putSchema refresh for an
// edit), so the trigger sits there and lets the missing sync token — not the
// call site — decide whether anything runs. Without this the collection stays
// empty until the hourly scheduler run.
import { syncNewCalendarCollections } from "@mulmoclaude/core/google";
import { log } from "../../system/logger/index.js";
import { logBackgroundError } from "../../utils/logBackgroundError.js";
import { makeSingleFlight } from "../../utils/singleFlight.js";
import { workspacePath } from "../../workspace/workspace.js";

// Authoring a collection writes several files in a burst (SKILL.md, schema.json,
// templates), each firing its own refresh. Coalescing keeps that burst to one
// full calendar walk — the trailing re-run still picks up a collection whose
// schema landed mid-pass.
const runSync = makeSingleFlight(async () => {
  const results = await syncNewCalendarCollections(workspacePath);
  if (results.length === 0) return;
  const written = results.reduce((total, result) => total + result.written, 0);
  log.info("google", "first calendar sync complete", { collections: results.map((result) => result.slug), written });
});

/** Kick off the first sync of any calendar this workspace has never synced.
 *  Fire-and-forget on purpose: a first sync walks the whole calendar and this
 *  runs inside the agent's tool turn. */
export function startInitialCalendarSync(): void {
  void runSync().catch(logBackgroundError("google", "initial calendar sync failed"));
}
