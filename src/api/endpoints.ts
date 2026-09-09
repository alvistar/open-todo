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

/**
 * Walks every page of a collection. Vikunja caps a page at 50, and the total
 * page count comes back in x-pagination-total-pages; when the header is absent
 * we stop as soon as a short page arrives.
 */
async function fetchAllPages<T>(
  http: Http,
  path: string,
  options: RequestOptions = {},
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalPages: number | undefined;

  do {
    const result: ListResult<T> = await http.listRequest<T>(path, {
      ...options,
      query: { ...options.query, page, per_page: MAX_PAGE_SIZE },
    });
    all.push(...result.items);
    totalPages = result.totalPages;
    if (result.items.length < MAX_PAGE_SIZE && totalPages === undefined) break;
    page += 1;
  } while (totalPages !== undefined && page <= totalPages);

  return all;
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
