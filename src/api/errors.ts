/** Base for everything the API layer throws, so callers can catch one type. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * An error Vikunja described in its body: `{ code, message }`. `code` is
 * Vikunja's own numeric error code, not the HTTP status.
 */
export class VikunjaError extends ApiError {
  readonly code: number | undefined;

  constructor(message: string, status: number, code?: number) {
    super(message, status);
    this.name = "VikunjaError";
    this.code = code;
  }
}

/** The request never produced a response: offline, DNS, TLS, or CORS. */
export class NetworkError extends ApiError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 0);
    this.name = "NetworkError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** The stored credential is not (or no longer) accepted. */
export class UnauthorizedError extends VikunjaError {
  constructor(message: string, code?: number) {
    super(message, 401, code);
    this.name = "UnauthorizedError";
  }
}

export function isUnauthorized(error: unknown): error is UnauthorizedError {
  return error instanceof ApiError && error.status === 401;
}
