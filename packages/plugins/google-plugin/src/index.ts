// Google plugin — server side. Thin dispatch over the shared engine in
// @mulmoclaude/core/google: the OAuth grant, token file, and the Calendar /
// Tasks / Drive REST calls are owned by core, so this tool, the host's
// settings UI, remote commands, and auth CLI all share one link state.
// Server-only (no Vue View) — results render as plain tool output in the
// chat. User-facing guidance stays host-neutral (#2128): the plugin runs on
// multiple hosts (MulmoClaude, MulmoTerminal) whose link flows differ, and
// each host's own help carries the specific steps.
import { definePlugin } from "gui-chat-protocol";
import {
  clearCalendarSyncToken,
  clientSecretPresence,
  completeTask,
  createCalendarEvent,
  createDriveFile,
  createTask,
  deleteCalendarEvent,
  deleteTask,
  getCalendarColors,
  getGoogleAccessToken,
  listCalendarEvents,
  listCalendars,
  listDriveFiles,
  listTaskLists,
  listTasks,
  loadCalendarSyncToken,
  loadGoogleTokens,
  readDriveFile,
  saveCalendarSyncToken,
  syncCalendarEvents,
  uncompleteTask,
  updateCalendarEvent,
  updateTask,
  DEFAULT_LIST_MAX_RESULTS,
  type CalendarSyncResult,
} from "@mulmoclaude/core/google";
import { GoogleArgs } from "./args";
import { TOOL_DEFINITION } from "./definition";

export { TOOL_DEFINITION };

const LINK_GUIDANCE = "Ask the user to link their Google account in this app's settings, then retry.";

// A sync can legitimately return an entire calendar's history on its first
// run, so the tool answers with counts plus a capped sample — the whole point
// of incremental sync is to stop burning context on calendar data (#2095).
const SYNC_SAMPLE_LIMIT = 20;

const summarizeSync = (result: CalendarSyncResult, incremental: boolean) => {
  const active = result.events.filter((event) => event.status !== "cancelled");
  const cancelled = result.events.length - active.length;
  return {
    ok: true,
    incremental,
    changed: active.length,
    cancelled,
    events: active.slice(0, SYNC_SAMPLE_LIMIT),
    truncated: active.length > SYNC_SAMPLE_LIMIT,
  };
};

// 410 means the stored token aged out; drop it and start clean rather than
// surfacing an error the user can do nothing about.
async function restartFullSync(accessToken: string, calendarId: string | undefined): Promise<CalendarSyncResult> {
  await clearCalendarSyncToken(calendarId);
  return await syncCalendarEvents(accessToken, { calendarId });
}

async function runCalendarSync(calendarId: string | undefined, fullResync: boolean): Promise<unknown> {
  const accessToken = await getGoogleAccessToken();
  // Drop the token BEFORE rebuilding, not after: if the full sync then fails
  // mid-way, the next run must still start clean rather than silently resuming
  // from the stale state the user asked to discard.
  if (fullResync) await clearCalendarSyncToken(calendarId);
  const storedToken = fullResync ? null : await loadCalendarSyncToken(calendarId);
  const first = await syncCalendarEvents(accessToken, { calendarId, syncToken: storedToken ?? undefined });
  const result = first.fullResyncRequired ? await restartFullSync(accessToken, calendarId) : first;
  if (result.nextSyncToken) await saveCalendarSyncToken(calendarId, result.nextSyncToken);
  const incremental = Boolean(storedToken) && !first.fullResyncRequired;
  return { ...summarizeSync(result, incremental), expiredToken: first.fullResyncRequired };
}

export default definePlugin(({ log }) => {
  const dispatch = async (args: GoogleArgs): Promise<unknown> => {
    switch (args.kind) {
      case "status": {
        const [tokens, clientSecret] = await Promise.all([loadGoogleTokens(), clientSecretPresence()]);
        const linked = Boolean(tokens?.refresh_token);
        return { ok: true, linked, clientSecret, ...(linked ? {} : { guidance: LINK_GUIDANCE }) };
      }
      case "calendarListCalendars": {
        return { ok: true, calendars: await listCalendars(await getGoogleAccessToken()) };
      }
      case "calendarColors": {
        return { ok: true, colors: await getCalendarColors(await getGoogleAccessToken()) };
      }
      case "calendarListEvents": {
        const events = await listCalendarEvents(await getGoogleAccessToken(), {
          calendarId: args.calendarId,
          timeMin: args.timeMin,
          maxResults: args.maxResults ?? DEFAULT_LIST_MAX_RESULTS,
        });
        return { ok: true, events };
      }
      case "calendarSync": {
        return await runCalendarSync(args.calendarId, args.fullResync ?? false);
      }
      case "calendarCreateEvent": {
        const event = await createCalendarEvent(await getGoogleAccessToken(), {
          summary: args.summary,
          startDateTime: args.start,
          endDateTime: args.end,
          description: args.description,
          calendarId: args.calendarId,
          colorId: args.colorId,
        });
        // Log ids only — titles / bodies are personal content.
        log.info("calendar event created", { id: event.id });
        return { ok: true, event };
      }
      case "calendarUpdateEvent": {
        const event = await updateCalendarEvent(await getGoogleAccessToken(), {
          eventId: args.eventId,
          summary: args.summary,
          startDateTime: args.start,
          endDateTime: args.end,
          description: args.description,
          calendarId: args.calendarId,
          colorId: args.colorId,
        });
        log.info("calendar event updated", { id: event.id });
        return { ok: true, event };
      }
      case "calendarDeleteEvent": {
        await deleteCalendarEvent(await getGoogleAccessToken(), { eventId: args.eventId, calendarId: args.calendarId });
        log.info("calendar event deleted", { id: args.eventId });
        return { ok: true, deleted: args.eventId };
      }
      case "taskListsList": {
        return { ok: true, taskLists: await listTaskLists(await getGoogleAccessToken()) };
      }
      case "tasksList": {
        const tasks = await listTasks(await getGoogleAccessToken(), {
          taskListId: args.taskListId,
          maxResults: args.maxResults ?? DEFAULT_LIST_MAX_RESULTS,
          showCompleted: args.showCompleted,
        });
        return { ok: true, tasks };
      }
      case "tasksCreate": {
        const task = await createTask(await getGoogleAccessToken(), {
          title: args.title,
          notes: args.notes,
          due: args.due,
          taskListId: args.taskListId,
        });
        log.info("task created", { id: task.id });
        return { ok: true, task };
      }
      case "tasksUpdate": {
        const task = await updateTask(await getGoogleAccessToken(), {
          taskId: args.taskId,
          title: args.title,
          notes: args.notes,
          due: args.due,
          taskListId: args.taskListId,
        });
        log.info("task updated", { id: task.id });
        return { ok: true, task };
      }
      case "tasksComplete": {
        const task = await completeTask(await getGoogleAccessToken(), { taskId: args.taskId, taskListId: args.taskListId });
        return { ok: true, task };
      }
      case "tasksUncomplete": {
        const task = await uncompleteTask(await getGoogleAccessToken(), { taskId: args.taskId, taskListId: args.taskListId });
        return { ok: true, task };
      }
      case "tasksDelete": {
        await deleteTask(await getGoogleAccessToken(), { taskId: args.taskId, taskListId: args.taskListId });
        log.info("task deleted", { id: args.taskId });
        return { ok: true, deleted: args.taskId };
      }
      case "driveList": {
        const files = await listDriveFiles(await getGoogleAccessToken(), { maxResults: args.maxResults ?? DEFAULT_LIST_MAX_RESULTS });
        return { ok: true, files };
      }
      case "driveCreate": {
        const file = await createDriveFile(await getGoogleAccessToken(), { name: args.name, content: args.content, mimeType: args.mimeType });
        log.info("drive file created", { id: file.id });
        return { ok: true, file };
      }
      case "driveRead": {
        const { file, content } = await readDriveFile(await getGoogleAccessToken(), { fileId: args.fileId });
        return { ok: true, file, content };
      }
      default: {
        const exhaustive: never = args;
        throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  };

  return {
    TOOL_DEFINITION,

    async google(rawArgs: unknown) {
      return await dispatch(GoogleArgs.parse(rawArgs));
    },
  };
});
