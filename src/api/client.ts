import { getToken, logOut } from "../auth/authStore";
import { getBaseUrl } from "../settings/settingsStore";
import { createHttp } from "./http";

/**
 * The app-wide client. A 401 drops the stored credential, which flips the
 * App gate back to the login screen — Vikunja 2.5.0 has no refresh flow, so an
 * expired JWT genuinely means logging in again.
 */
export const http = createHttp({
  getBaseUrl,
  getToken,
  onUnauthorized: logOut,
});
