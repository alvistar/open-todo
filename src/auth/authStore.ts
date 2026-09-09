import { createPersistentValue, usePersistentValue } from "../store/persistentValue";

/**
 * The credential sent as `Authorization: Bearer`. Either a JWT from
 * POST /login or an API token the user pasted.
 *
 * localStorage is parity with Vikunja's own frontend (HANDOVER D5, "Token
 * custody"): without a proxy there is nowhere else to keep it.
 */
export const tokenValue = createPersistentValue("open-todo.token");

export function getToken(): string | null {
  return tokenValue.get();
}

export function setToken(token: string): void {
  tokenValue.set(token);
}

/** Clears the credential only; the server URL is kept so login is one step. */
export function logOut(): void {
  tokenValue.clear();
}

export function useToken(): string | null {
  return usePersistentValue(tokenValue);
}
