import { NetworkError, UnauthorizedError, VikunjaError } from "./errors";

export interface HttpConfig {
  /** Instance root, e.g. "https://vikunja.example". No /api/v1 suffix. */
  getBaseUrl: () => string | null;
  getToken: () => string | null;
  /** Called once per 401 so the app can drop the token and return to login. */
  onUnauthorized?: () => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Array values are repeated, which is how Vikunja takes sort_by/order_by. */
  query?: Record<string, string | number | boolean | undefined | string[]>;
  signal?: AbortSignal;
  /** Send without the Authorization header (login). */
  anonymous?: boolean;
}

export interface ListResult<T> {
  items: T[];
  /** From x-pagination-total-pages; undefined when the server omits it. */
  totalPages?: number;
  /** From x-pagination-result-count. */
  resultCount?: number;
}

/** Strips a trailing slash and any /api/vN the user pasted along with the host. */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "");
  url = url.replace(/\/api\/v\d+$/i, "");
  return url;
}

export function apiUrl(baseUrl: string, path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeBaseUrl(baseUrl)}/api/v1${suffix}`;
}

function buildQuery(query: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

function readNumericHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw == null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export interface Http {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  listRequest<T>(path: string, options?: RequestOptions): Promise<ListResult<T>>;
}

export function createHttp(config: HttpConfig): Http {
  const doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function send(path: string, options: RequestOptions): Promise<Response> {
    const baseUrl = config.getBaseUrl();
    if (!baseUrl) throw new NetworkError("No Vikunja server configured.");

    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (!options.anonymous) {
      const token = config.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const url = apiUrl(baseUrl, path) + buildQuery(options.query);

    let response: Response;
    try {
      response = await doFetch(url, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      // Match on the name, not the class: an abort that arrives as something
      // other than a DOMException would otherwise be rewrapped as a
      // NetworkError carrying a misleading "check cors.origins" message.
      if ((cause as { name?: string } | null)?.name === "AbortError") throw cause;
      // fetch rejects the same way for offline, DNS and a blocked CORS
      // preflight; the message points at the most actionable of the three.
      throw new NetworkError(
        `Could not reach ${normalizeBaseUrl(baseUrl)}. Check the URL, that the server is running, and that this origin is listed in Vikunja's cors.origins.`,
        { cause },
      );
    }

    if (!response.ok) throw await toError(response, options);
    return response;
  }

  async function toError(
    response: Response,
    options: RequestOptions,
  ): Promise<VikunjaError> {
    let message = `${response.status} ${response.statusText}`.trim();
    let code: number | undefined;
    try {
      const body = (await response.json()) as { message?: string; code?: number };
      if (typeof body?.message === "string" && body.message) message = body.message;
      if (typeof body?.code === "number") code = body.code;
    } catch {
      // Non-JSON error body (a proxy's HTML page, say): keep the status line.
    }
    if (response.status === 401) {
      // Only a request that actually carried the credential can condemn it.
      // /info and /login are sent anonymously; behind an authenticating
      // reverse proxy they can answer 401 for reasons that say nothing about
      // the stored token, and logging the user out on that would be wrong.
      if (!options.anonymous) config.onUnauthorized?.();
      return new UnauthorizedError(message, code);
    }
    return new VikunjaError(message, response.status, code);
  }

  async function parse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  return {
    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
      return parse<T>(await send(path, options));
    },

    async listRequest<T>(
      path: string,
      options: RequestOptions = {},
    ): Promise<ListResult<T>> {
      const response = await send(path, options);
      const body = await parse<T[] | null>(response);
      const totalPages = readNumericHeader(response.headers, "x-pagination-total-pages");
      const resultCount = readNumericHeader(
        response.headers,
        "x-pagination-result-count",
      );
      return {
        // Vikunja answers `null` rather than `[]` for an empty collection.
        items: Array.isArray(body) ? body : [],
        ...(totalPages === undefined ? {} : { totalPages }),
        ...(resultCount === undefined ? {} : { resultCount }),
      };
    },
  };
}
