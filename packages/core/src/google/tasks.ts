// Google Tasks v1 REST calls. `@default` is Google's alias for the user's
// default task list, so callers can stay list-agnostic.
import { asRecord, googleRequest, itemsOf, stringField, DEFAULT_LIST_MAX_RESULTS } from "./apiClient.js";

const TASKS_BASE_URL = "https://tasks.googleapis.com/tasks/v1";
const TASKS_API_LABEL = "Google Tasks API";
const DEFAULT_TASK_LIST_ID = "@default";
const TASK_STATUS_COMPLETED = "completed";
const MAX_TASK_LISTS = 50;

export interface TaskListSummary {
  id: string;
  title: string;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  due: string;
  notes: string;
}

export interface ListTasksInput {
  taskListId?: string;
  maxResults?: number;
  showCompleted?: boolean;
}

export interface CreateTaskInput {
  title: string;
  notes?: string;
  /** RFC3339. Google stores a DATE only — the time part is recorded but
   *  ignored by the UI, so callers should not promise time-of-day fidelity. */
  due?: string;
  taskListId?: string;
}

export interface CompleteTaskInput {
  taskId: string;
  taskListId?: string;
}

export interface UpdateTaskInput {
  taskId: string;
  title?: string;
  /** `""` clears the notes; omit to leave them untouched. */
  notes?: string;
  /** RFC3339. Same DATE-only caveat as `CreateTaskInput.due`. Google rejects
   *  `""`, so a due date can be changed but not removed through this call. */
  due?: string;
  taskListId?: string;
}

export const toTaskListSummary = (value: unknown): TaskListSummary => {
  const record = asRecord(value);
  return { id: stringField(record, "id"), title: stringField(record, "title") };
};

export const toTaskSummary = (value: unknown): TaskSummary => {
  const record = asRecord(value);
  return {
    id: stringField(record, "id"),
    title: stringField(record, "title"),
    status: stringField(record, "status"),
    due: stringField(record, "due"),
    notes: stringField(record, "notes"),
  };
};

const tasksUrl = (taskListId: string | undefined, suffix = ""): string =>
  `${TASKS_BASE_URL}/lists/${encodeURIComponent(taskListId ?? DEFAULT_TASK_LIST_ID)}/tasks${suffix}`;

export async function listTaskLists(accessToken: string): Promise<TaskListSummary[]> {
  const listed = await googleRequest(TASKS_API_LABEL, accessToken, `${TASKS_BASE_URL}/users/@me/lists?maxResults=${MAX_TASK_LISTS}`);
  return itemsOf(listed).map(toTaskListSummary);
}

export async function listTasks(accessToken: string, input: ListTasksInput = {}): Promise<TaskSummary[]> {
  const params = new URLSearchParams({
    maxResults: String(input.maxResults ?? DEFAULT_LIST_MAX_RESULTS),
    showCompleted: String(input.showCompleted ?? false),
  });
  const listed = await googleRequest(TASKS_API_LABEL, accessToken, `${tasksUrl(input.taskListId)}?${params.toString()}`);
  return itemsOf(listed).map(toTaskSummary);
}

export async function createTask(accessToken: string, input: CreateTaskInput): Promise<TaskSummary> {
  const body = { title: input.title, notes: input.notes, due: input.due };
  const created = await googleRequest(TASKS_API_LABEL, accessToken, tasksUrl(input.taskListId), { method: "POST", body: JSON.stringify(body) });
  return toTaskSummary(created);
}

/** PATCH body for a task edit — only the fields the caller supplied. As with
 *  events, `undefined` means "leave as is" and `""` means "clear it", so the
 *  two must stay distinct. `status` is deliberately absent: `completeTask`
 *  owns that transition, and two ways to set it would drift apart. */
export const buildTaskPatch = (input: UpdateTaskInput): Record<string, unknown> => ({
  ...(input.title !== undefined ? { title: input.title } : {}),
  ...(input.notes !== undefined ? { notes: input.notes } : {}),
  ...(input.due !== undefined ? { due: input.due } : {}),
});

export async function updateTask(accessToken: string, input: UpdateTaskInput): Promise<TaskSummary> {
  const url = tasksUrl(input.taskListId, `/${encodeURIComponent(input.taskId)}`);
  const updated = await googleRequest(TASKS_API_LABEL, accessToken, url, { method: "PATCH", body: JSON.stringify(buildTaskPatch(input)) });
  return toTaskSummary(updated);
}

export async function completeTask(accessToken: string, input: CompleteTaskInput): Promise<TaskSummary> {
  // PATCH keeps the rest of the task intact — a PUT would need the full body
  // and would silently drop fields the caller never read.
  const url = tasksUrl(input.taskListId, `/${encodeURIComponent(input.taskId)}`);
  const updated = await googleRequest(TASKS_API_LABEL, accessToken, url, {
    method: "PATCH",
    body: JSON.stringify({ status: TASK_STATUS_COMPLETED }),
  });
  return toTaskSummary(updated);
}

export async function deleteTask(accessToken: string, input: CompleteTaskInput): Promise<void> {
  const url = tasksUrl(input.taskListId, `/${encodeURIComponent(input.taskId)}`);
  await googleRequest(TASKS_API_LABEL, accessToken, url, { method: "DELETE" });
}
