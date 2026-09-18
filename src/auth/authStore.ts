import {
  clearPersistenceNotice,
  reportPersistenceFailure,
} from "../store/persistenceNotice";
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

export function setToken(token: string) {
  const result = tokenValue.set(token);
  if (result.persisted) {
    clearPersistenceNotice("credential");
  } else {
    reportPersistenceFailure(
      "credential",
      "This session is active, but the credential could not be saved for the next restart. Check browser storage and try again.",
    );
  }
  return result;
}

/** Clears the credential only; the server URL is kept so login is one step. */
export function logOut() {
  const result = tokenValue.clear();
  if (result.persisted) {
    clearPersistenceNotice("credential");
  } else {
    reportPersistenceFailure(
      "credential",
      "You are signed out in this session, but removing the saved credential failed. Check browser storage and retry before sharing this device.",
    );
  }
  return result;
}

export function useToken(): string | null {
  return usePersistentValue(tokenValue);
}
