import { ApiError } from "./errors";
import type { Http, ListResult, RequestOptions } from "./http";
import type {
  Info,
  Label,
  LoginRequest,
  LoginResponse,
  Project,
  Task,
  TaskComment,
  TaskReminder,
  User,
} from "./types";

/** Vikunja's own maximum page size. */
export const MAX_PAGE_SIZE = 50;

export function getInfo(http: Http, signal?: AbortSignal): Promise<Info> {
  // /info is unauthenticated: it is what the setup screen probes.
  return http.request<Info>("/info", {
    anonymous: true,
    ...(signal ? { signal } : {}),
  });
}

export function login(http: Http, request: LoginRequest): Promise<LoginResponse> {
  return http.request<LoginResponse>("/login", {
    method: "POST",
    anonymous: true,
    body: { long_token: true, ...request },
  });
}

export function getUser(http: Http, signal?: AbortSignal): Promise<User> {
  return http.request<User>("/user", signal ? { signal } : {});
}

/** Refuses to spin if a server ignores `page` and keeps answering full pages. */
const MAX_PAGES = 200;

/**
 * Walks every page of a collection.
 *
 * The page size is the stop condition, NOT the x-pagination-total-pages header.
 * That header is not CORS-safelisted, so a browser on a different origin from
 * Vikunja - which is this app's whole deployment model (D5, no proxy) - reads
 * it as null unless the instance sends Access-Control-Expose-Headers naming it.
 * An earlier version keyed the loop off the header and silently truncated every
 * collection to 50 items whenever it was unreadable; worse, a truncated *full*
 * fetch makes PollingSource's id-set diff report the missing tasks as
 * deletions, so they vanish from the UI as though someone had removed them.
 *
 * A short page therefore ends the walk. The header, when it is readable, only
 * saves the one extra probe after an exactly-full last page.
 */
async function fetchAllPages<T>(
  http: Http,
  path: string,
  options: RequestOptions = {},
): Promise<T[]> {
  const all: T[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result: ListResult<T> = await http.listRequest<T>(path, {
      ...options,
      query: { ...options.query, page, per_page: MAX_PAGE_SIZE },
    });
    all.push(...result.items);

    // A page shorter than the maximum is the last one, header or no header.
    if (result.items.length < MAX_PAGE_SIZE) return all;
    // When the header IS readable it spares us the extra empty request.
    if (result.totalPages !== undefined && page >= result.totalPages) return all;
  }

  throw new ApiError(
    `Refusing to read more than ${MAX_PAGES} pages from ${path}: the server keeps returning full pages, so it is probably ignoring the "page" parameter.`,
    0,
  );
}

export function listProjects(http: Http, signal?: AbortSignal): Promise<Project[]> {
  return fetchAllPages<Project>(http, "/projects", signal ? { signal } : {});
}

export function listLabels(http: Http, signal?: AbortSignal): Promise<Label[]> {
  return fetchAllPages<Label>(http, "/labels", signal ? { signal } : {});
}

export interface CreateTaskInput {
  title: string;
  /** RFC 3339. Vikunja has no all-day flag; see D-map-2. */
  due_date?: string;
  priority?: number;
  repeat_after?: number;
  repeat_mode?: number;
}

/**
 * Creates a task in a project. Vikunja's create verb is PUT, not POST.
 *
 * Labels are NOT part of this call: they are a sub-resource on the task
 * (mapping §2), so a task with labels is a create followed by addLabel.
 */
export function createTask(
  http: Http,
  projectId: number,
  input: CreateTaskInput,
): Promise<Task> {
  return http.request<Task>(`/projects/${projectId}/tasks`, {
    method: "PUT",
    body: input,
  });
}

/** Attaches an existing label to a task (`PUT /tasks/{id}/labels`). */
export function addLabel(http: Http, taskId: number, labelId: number): Promise<unknown> {
  return http.request(`/tasks/${taskId}/labels`, {
    method: "PUT",
    body: { label_id: labelId },
  });
}

/**
 * Creates a label (`PUT /labels`), which the whole instance then has.
 *
 * Never a side effect of typing: the label namespace is shared by every task
 * and every project, so a typo made here is not undoable by the person who
 * made it. It is reached by pressing a button that names what will be created.
 */
export function createLabel(http: Http, title: string): Promise<Label> {
  return http.request<Label>("/labels", { method: "PUT", body: { title } });
}

/** Removes a label from the instance entirely (`DELETE /labels/{id}`). */
export function deleteLabel(http: Http, labelId: number): Promise<void> {
  return http.request<void>(`/labels/${labelId}`, { method: "DELETE" });
}

/** Detaches one (`DELETE /tasks/{id}/labels/{labelId}`). */
export function removeLabel(http: Http, taskId: number, labelId: number): Promise<void> {
  return http.request<void>(`/tasks/${taskId}/labels/${labelId}`, {
    method: "DELETE",
  });
}

/**
 * One task, fresh from the server.
 *
 * Needed because the label calls answer with the RELATION, not the task, so
 * after attaching or detaching there is no updated copy to put in the cache -
 * and the dialog reads its task out of that cache. Re-reading is also what
 * keeps `updateTask`'s "must be a server copy" contract true for whatever
 * write comes next.
 */
export function getTask(http: Http, taskId: number): Promise<Task> {
  return http.request<Task>(`/tasks/${taskId}`);
}

/**
 * The task fields open-todo writes. Each key present becomes one entry in the
 * bulk call's `fields` list, so writing a field and naming it cannot drift
 * apart.
 */
export interface TaskPatch {
  done?: boolean;
  title?: string;
  /** Vikunja stores HTML from its own editor; see mapping §2. */
  description?: string;
  /** RFC 3339; see D-map-2 for what an all-day date means. */
  due_date?: string;
  priority?: number;
  /** Moving a task between projects. Resets its bucket, per mapping §2. */
  project_id?: number;
}

/**
 * Sub-resources that ride along with a column write.
 *
 * `reminders` is the only way to author reminders at all: Vikunja handles them
 * OUTSIDE the `fields` guard, so they reach the server through the echo below
 * and nowhere else. Naming them here rather than handing `updateTask` a
 * modified task is what keeps its "server copy" contract true - and an empty
 * list is the one thing the echo cannot say by omission, because omission is
 * how the server is told to delete them.
 */
export interface TaskOverrides {
  reminders?: TaskReminder[];
}

interface BulkTaskResponse {
  tasks?: Task[] | null;
}

/**
 * Writes named fields of ONE task, leaving the rest of it alone.
 *
 * It goes through the BULK endpoint for a single task on purpose. Vikunja's
 * single-task route, `POST /tasks/{id}`, is not a patch: `updateSingleTask`
 * merges the body over the stored row with mergo (which skips zero values) and
 * then re-applies every zero by hand, so a body of `{id, done}` erases
 * description, due_date, start/end date, priority, percent_done, hex_color,
 * repeat_after, repeat_mode, is_favorite, every reminder and every assignee.
 * `POST /tasks/bulk` is the only v1 path that passes a `fields` list, and under
 * `fields` the columns that are not named are re-read from the stored row.
 * Measured against the v2.5.0 source; see D-write in docs/HANDOVER.md.
 *
 * Two sub-resources are NOT covered by that guard and are therefore echoed back
 * from the caller's copy of the task:
 *
 *   - assignees: `updateTaskAssignees` runs before the guard and reads an empty
 *     list as "the user removed them all";
 *   - reminders: `updateReminders` deletes every row and re-inserts whatever
 *     the payload carries, which for an omitted list is nothing.
 *
 * Taking the whole task rather than an id is what makes that impossible to
 * forget. `src/api/integration.write.test.ts` checks it against a real server.
 *
 * CONTRACT: `task` must be a copy the SERVER gave us - from a listing, or from
 * this call's own response. A hand-built object whose `reminders` or
 * `assignees` happen to be absent echoes an empty list, and an empty list is
 * exactly how the server is told to delete them. There is no way to tell the
 * two apart on the wire, which is why the parameter is the whole Task.
 *
 * To CHANGE reminders, name them in `overrides` rather than doctoring the task:
 * the contract above stays true and the write is visible where it is made.
 */
export async function updateTask(
  http: Http,
  task: Task,
  values: TaskPatch,
  overrides: TaskOverrides = {},
): Promise<Task> {
  const fields = Object.keys(values);
  if (fields.length === 0) {
    /*
     * A caller bug, not a server one: ApiError would file it under "the
     * instance did something odd".
     *
     * It is also a GUARD, not a formality. An empty `fields` list does not
     * mean "write no columns" - measured on `pinguino` 2026-09-15, it wipes
     * the task, because no column is named and therefore none is re-read from
     * the stored row. See `updateReminders` for the way to write a
     * sub-resource without naming a column you meant to change.
     */
    throw new Error("updateTask was asked to write no fields.");
  }

  const response = await http.request<BulkTaskResponse | Task[]>("/tasks/bulk", {
    method: "POST",
    body: {
      task_ids: [task.id],
      fields,
      values: {
        ...values,
        reminders: overrides.reminders ?? task.reminders ?? [],
        assignees: task.assignees ?? [],
      },
    },
  });

  // The handler returns the BulkTask struct with `tasks` filled in; its own
  // swagger annotation promises a bare array. Accept either.
  const updated = Array.isArray(response) ? response[0] : response?.tasks?.[0];
  if (!updated) {
    throw new ApiError(`Updating task ${task.id} did not return the updated task.`, 0);
  }
  return updated;
}

/**
 * Replaces a task's reminders, and changes nothing else.
 *
 * It names `title` and writes back the title the SERVER gave us, which looks
 * like a no-op and is not optional. Reminders live outside the `fields` guard,
 * so the obvious call - an empty `fields` list carrying only reminders - looks
 * like "write no columns". It is not.
 *
 * MEASURED on `pinguino` 2026-09-15: `fields: []` erased the task. A scratch
 * task with priority 3, a due date and a description came back with priority
 * 0, `due_date` unset and an empty description, with only the new reminder
 * intact. An empty list means "no column is protected", not "no column is
 * written", and the zero-reapply path of mapping §6 item 13 does the rest.
 *
 * Naming one column re-reads every OTHER column from the stored row, which is
 * exactly what is wanted. `title` is the choice because it is a value we hold
 * from the server copy and writing it back cannot trigger anything: `done`
 * would run the repeat handler and ADVANCE a recurring task, and `project_id`
 * resets the bucket (mapping §2). The cost is a narrow race - a rename by
 * another client inside the poll window would be reverted - and that is the
 * cheapest of the available harms.
 */
export function updateReminders(
  http: Http,
  task: Task,
  reminders: TaskReminder[],
): Promise<Task> {
  return updateTask(http, task, { title: task.title }, { reminders });
}

/**
 * A task's comments, oldest first, as `GET /tasks/{id}/comments` returns them.
 *
 * Measured on `pinguino` 2026-09-15: the body field is `comment` and carries
 * HTML, and the author comes back expanded on both the list and the create.
 */
export function listComments(
  http: Http,
  taskId: number,
  signal?: AbortSignal,
): Promise<TaskComment[]> {
  return fetchAllPages<TaskComment>(
    http,
    `/tasks/${taskId}/comments`,
    signal ? { signal } : {},
  );
}

/** Adds one (`PUT /tasks/{id}/comments`). Vikunja's create verb again. */
export function createComment(
  http: Http,
  taskId: number,
  comment: string,
): Promise<TaskComment> {
  return http.request<TaskComment>(`/tasks/${taskId}/comments`, {
    method: "PUT",
    body: { comment },
  });
}

/**
 * Deletes a task. Vikunja soft-deletes with 30-day retention, and `deleted_at`
 * is not a filterable field (mapping §6 item 3), so the incremental poll can
 * never report this: whoever calls it removes the row locally.
 */
export function deleteTask(http: Http, taskId: number): Promise<void> {
  return http.request<void>(`/tasks/${taskId}`, { method: "DELETE" });
}

export interface ListTasksParams {
  /** A Vikunja filter expression; see ./filter.ts. */
  filter?: string;
  sortBy?: string[];
  orderBy?: ("asc" | "desc")[];
  /** Include tasks whose sorted field is null (e.g. no due date). */
  includeNulls?: boolean;
  /** IANA zone, so `now/d` date math lands on the viewer's midnight. */
  timezone?: string;
  expand?: string;
  signal?: AbortSignal;
}

/**
 * The task listing. Route note (mapping §6): it is `GET /tasks` on 2.5.0 —
 * `/tasks/all` no longer exists and answers 400.
 */
export function listTasks(http: Http, params: ListTasksParams = {}): Promise<Task[]> {
  const query: RequestOptions["query"] = {};
  if (params.filter) query.filter = params.filter;
  if (params.sortBy?.length) query.sort_by = params.sortBy;
  if (params.orderBy?.length) query.order_by = params.orderBy;
  if (params.includeNulls) query.filter_include_nulls = "true";
  if (params.timezone) query.filter_timezone = params.timezone;
  if (params.expand) query.expand = params.expand;

  return fetchAllPages<Task>(http, "/tasks", {
    query,
    ...(params.signal ? { signal: params.signal } : {}),
  });
}
