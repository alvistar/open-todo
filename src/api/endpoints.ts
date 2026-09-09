import { ApiError } from "./errors";
import type { Http, ListResult, RequestOptions } from "./http";
import type {
  Info,
  Label,
  LoginRequest,
  LoginResponse,
  Project,
  Task,
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
