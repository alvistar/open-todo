/*
 * The subset of Vikunja's API surface the foundation slice reads. Fields we do
 * not use are deliberately omitted rather than typed loosely, so a rename
 * upstream shows up as a type error where it matters.
 */

export interface Info {
  version: string;
  frontend_url?: string;
  motd?: string;
}

export interface UserSettings {
  name?: string;
  timezone?: string;
  default_project_id?: number;
  /** 2.6+; absent on older servers, where D-map-2's 20:00 fallback applies. */
  frontend_settings?: { default_due_time?: string | null } | null;
}

export interface User {
  id: number;
  username: string;
  name?: string;
  settings?: UserSettings | null;
}

export interface ProjectView {
  id: number;
  project_id: number;
  title: string;
  view_kind: "list" | "gantt" | "table" | "kanban" | string;
}

export interface Project {
  id: number;
  title: string;
  description?: string;
  hex_color?: string;
  parent_project_id?: number;
  position?: number;
  is_favorite?: boolean;
  is_archived?: boolean;
  views?: ProjectView[] | null;
}

/**
 * A saved filter, as `GET /filters/{id}` returns it.
 *
 * It arrives in `GET /projects` too, but only as a project shell under a
 * negative id with `filter` null (§6 item 15) — the query itself is readable
 * only here, one filter at a time: `GET /filters` answers 405.
 */
export interface SavedFilter {
  id: number;
  title: string;
  filters?: {
    filter?: string;
    filter_include_nulls?: boolean;
  } | null;
}

export interface Label {
  id: number;
  title: string;
  hex_color?: string;
}

export interface TaskRelation {
  id: number;
  title: string;
  done?: boolean;
}

/** Vikunja returns relations keyed by kind, e.g. `subtask` / `parenttask`. */
export type RelatedTasks = Partial<Record<string, TaskRelation[]>>;

export interface TaskReminder {
  reminder?: string | null;
  relative_period?: number;
  relative_to?: "due_date" | "start_date" | "end_date" | string;
}

/**
 * A comment. Vikunja stores it as HTML from its own editor, exactly like a
 * description (mapping §2), so it is read and written through the same
 * plain-text conversion.
 */
export interface TaskComment {
  id: number;
  comment: string;
  author?: User | null;
  created: string;
  updated: string;
}

export interface Task {
  id: number;
  identifier?: string;
  title: string;
  description?: string;
  done: boolean;
  done_at?: string | null;
  project_id: number;
  /** 0 unless the task was fetched through a view endpoint (mapping §3). */
  position?: number;
  priority?: number;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  repeat_after?: number;
  repeat_mode?: number;
  labels?: Label[] | null;
  assignees?: User[] | null;
  reminders?: TaskReminder[] | null;
  related_tasks?: RelatedTasks | null;
  /** Only present with `expand=comment_count`. */
  comment_count?: number;
  bucket_id?: number;
  created: string;
  updated: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  long_token?: boolean;
  totp_passcode?: string;
}

export interface LoginResponse {
  token: string;
}

/** Vikunja's zero value for a date, which means "unset". */
export const VIKUNJA_NULL_DATE = "0001-01-01T00:00:00Z";

export function hasDate(value: string | null | undefined): value is string {
  return Boolean(value) && value !== VIKUNJA_NULL_DATE;
}
