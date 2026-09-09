import { ApiError } from "../api/errors";

/**
 * Whether a failed login is asking for a TOTP passcode rather than rejecting
 * the credentials.
 *
 * The exact body Vikunja sends here has not been observed against a real
 * TOTP-enabled account (a known gap in the foundation slice), so this matches
 * on Vikunja's documented error code 1017 *and* on the message text, and
 * degrades to "wrong password" rather than to a stuck TOTP prompt.
 */
export function isTotpRequired(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const code = "code" in error ? error.code : undefined;
  if (code === 1017) return true;
  return /totp|one[- ]?time|two[- ]?factor/i.test(error.message);
}
