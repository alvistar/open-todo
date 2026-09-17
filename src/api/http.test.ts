import { describe, expect, it, vi } from "vitest";
import {
  InsecureTransportError,
  NetworkError,
  UnauthorizedError,
  VikunjaError,
} from "./errors";
import { apiUrl, createHttp, normalizeBaseUrl } from "./http";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function http(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createHttp>[0]> = {},
) {
  return createHttp({
    getBaseUrl: () => "https://vikunja.example",
    getToken: () => "tok",
    fetchImpl,
    ...overrides,
  });
}

describe("normalizeBaseUrl", () => {
  it("adds https when the scheme is missing", () => {
    expect(normalizeBaseUrl("vikunja.example")).toBe("https://vikunja.example");
  });

  it("keeps an explicit http scheme, for a LAN instance", () => {
    expect(normalizeBaseUrl("http://192.168.1.9:3456")).toBe("http://192.168.1.9:3456");
  });

  it("strips trailing slashes and a pasted /api/v1", () => {
    expect(normalizeBaseUrl("https://v.example/")).toBe("https://v.example");
    expect(normalizeBaseUrl("https://v.example/api/v1")).toBe("https://v.example");
    expect(normalizeBaseUrl("https://v.example/api/v2/")).toBe("https://v.example");
  });

  it("builds the /api/v1 path", () => {
    expect(apiUrl("https://v.example", "/tasks")).toBe("https://v.example/api/v1/tasks");
  });
});

describe("createHttp", () => {
  it("sends the bearer token and the query string", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 1 }));
    await http(fetchImpl as unknown as typeof fetch).request("/user", {
      query: { filter: "done = false", page: 2, skip: undefined },
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://vikunja.example/api/v1/user?filter=done+%3D+false&page=2");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.redirect).toBe("error");
  });

  it("omits the Authorization header for an anonymous request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ token: "t" }));
    await http(fetchImpl as unknown as typeof fetch).request("/login", {
      method: "POST",
      body: { username: "a" },
      anonymous: true,
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ username: "a" }));
  });

  it("allows an anonymous HTTP probe with no credential body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "2.5.0" }));
    await http(fetchImpl as unknown as typeof fetch, {
      getBaseUrl: () => "http://vikunja.lan:3456",
      getToken: () => null,
    }).request("/info", { anonymous: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks credential headers before an HTTP request without consent", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 1 }));
    await expect(
      http(fetchImpl as unknown as typeof fetch, {
        getBaseUrl: () => "http://vikunja.lan:3456",
      }).request("/user"),
    ).rejects.toBeInstanceOf(InsecureTransportError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks an anonymous login body before an HTTP request without consent", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ token: "t" }));
    await expect(
      http(fetchImpl as unknown as typeof fetch, {
        getBaseUrl: () => "http://vikunja.lan:3456",
        getToken: () => null,
      }).request("/login", {
        method: "POST",
        anonymous: true,
        body: { username: "a", password: "secret" },
      }),
    ).rejects.toBeInstanceOf(InsecureTransportError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("can override transport consent in a focused test", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 1 }));
    await http(fetchImpl as unknown as typeof fetch, {
      getBaseUrl: () => "http://vikunja.lan:3456",
      allowSensitiveRequest: () => true,
    }).request("/user");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("turns a Vikunja error body into a VikunjaError carrying its code", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 4001, message: "The task does not exist." }, { status: 404 }),
    );
    await expect(
      http(fetchImpl as unknown as typeof fetch).request("/tasks/9"),
    ).rejects.toMatchObject({
      name: "VikunjaError",
      status: 404,
      code: 4001,
      message: "The task does not exist.",
    });
  });

  it("falls back to the status line when the error body is not JSON", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>502</html>", { status: 502, statusText: "Bad Gateway" }),
    );
    const error = await http(fetchImpl as unknown as typeof fetch)
      .request("/tasks")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VikunjaError);
    expect((error as VikunjaError).message).toContain("502");
  });

  it("reports 401 as UnauthorizedError and calls onUnauthorized once", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { code: 4003, message: "missing, malformed or expired token" },
        { status: 401 },
      ),
    );
    const error = await http(fetchImpl as unknown as typeof fetch, { onUnauthorized })
      .request("/user")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does NOT log out on a 401 from an anonymous request", async () => {
    // /info and /login are sent without the credential. Behind an
    // authenticating reverse proxy they can 401 for reasons that say nothing
    // about the stored token; logging the user out there would be wrong.
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: "proxy auth required" }, { status: 401 }),
    );
    await expect(
      http(fetchImpl as unknown as typeof fetch, { onUnauthorized }).request("/info", {
        anonymous: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("reports a failed fetch as NetworkError and names the CORS cause", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await http(fetchImpl as unknown as typeof fetch)
      .request("/info")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toContain("cors.origins");
  });

  it("errors when no server is configured", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      http(fetchImpl as unknown as typeof fetch, { getBaseUrl: () => null }).request(
        "/info",
      ),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets an AbortError through untouched", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const error = await http(fetchImpl as unknown as typeof fetch)
      .request("/tasks")
      .catch((e: unknown) => e);
    expect((error as DOMException).name).toBe("AbortError");
  });

  it("reads the pagination headers", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ id: 1 }], {
        headers: {
          "Content-Type": "application/json",
          "x-pagination-total-pages": "3",
          "x-pagination-result-count": "50",
        },
      }),
    );
    const result = await http(fetchImpl as unknown as typeof fetch).listRequest("/tasks");
    expect(result.items).toHaveLength(1);
    expect(result.totalPages).toBe(3);
    expect(result.resultCount).toBe(50);
  });

  it("treats a null collection body as an empty list", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null));
    const result = await http(fetchImpl as unknown as typeof fetch).listRequest("/tasks");
    expect(result.items).toEqual([]);
    expect(result.totalPages).toBeUndefined();
  });
});
