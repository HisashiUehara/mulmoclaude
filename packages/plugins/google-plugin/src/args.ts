// Zod arg schemas for the `google` tool, in their own module so the
// dispatch (index.ts) and the tests can share them without pulling in
// the definePlugin factory body.
import { z } from "zod";
import { isIsoDateTimeWithOffset, MAX_LIST_RESULTS } from "@mulmoclaude/core/google";

// Calendar rejects date-only / offset-less / impossible values on `dateTime`
// with an opaque 400, so the strict shared validator runs here where the LLM
// gets an actionable message.
const IsoDateTimeWithOffset = z.string().refine(isIsoDateTimeWithOffset, {
  error: "must be an ISO 8601 date-time with a timezone offset (e.g. 2026-07-17T09:00:00+09:00)",
});

const MaxResults = z.number().int().min(1).max(MAX_LIST_RESULTS).optional();
const NonEmpty = z.string().min(1);
// Trimmed + non-empty: an empty/whitespace calendarId would build a malformed
// `/calendars//events` URL, and colorId "" would be sent as a bad palette id.
const OptionalNonEmpty = z.string().trim().min(1).optional();

export const GoogleArgs = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status") }),
  // Calendar
  z.object({ kind: z.literal("calendarListCalendars") }),
  z.object({ kind: z.literal("calendarColors") }),
  z.object({
    kind: z.literal("calendarListEvents"),
    calendarId: OptionalNonEmpty,
    timeMin: IsoDateTimeWithOffset.optional(),
    maxResults: MaxResults,
  }),
  z.object({
    kind: z.literal("calendarSync"),
    calendarId: OptionalNonEmpty,
    fullResync: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("calendarCreateEvent"),
    summary: NonEmpty,
    start: IsoDateTimeWithOffset,
    end: IsoDateTimeWithOffset,
    description: z.string().optional(),
    calendarId: OptionalNonEmpty,
    colorId: OptionalNonEmpty,
  }),
  // Tasks
  z.object({ kind: z.literal("taskListsList") }),
  z.object({
    kind: z.literal("tasksList"),
    taskListId: z.string().optional(),
    maxResults: MaxResults,
    showCompleted: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("tasksCreate"),
    title: NonEmpty,
    notes: z.string().optional(),
    due: IsoDateTimeWithOffset.optional(),
    taskListId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("tasksComplete"),
    taskId: NonEmpty,
    taskListId: z.string().optional(),
  }),
  // Drive (drive.file scope — app-created files only)
  z.object({ kind: z.literal("driveList"), maxResults: MaxResults }),
  z.object({
    kind: z.literal("driveCreate"),
    name: NonEmpty,
    content: z.string(),
    mimeType: z.string().optional(),
  }),
  z.object({ kind: z.literal("driveRead"), fileId: NonEmpty }),
]);
export type GoogleArgs = z.infer<typeof GoogleArgs>;
