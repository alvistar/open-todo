import { normalizeBaseUrl } from "../api/http";
import {
  clearPersistenceNotice,
  reportPersistenceFailure,
} from "../store/persistenceNotice";
import { createPersistentValue, usePersistentValue } from "../store/persistentValue";

/**
 * The Vikunja instance this browser talks to. There is no proxy (D5 revised),
 * so the URL is a per-install setting the user supplies on first run.
 */
export const baseUrlValue = createPersistentValue("open-todo.baseUrl", normalizeBaseUrl);

export function getBaseUrl(): string | null {
  return baseUrlValue.get();
}

export function setBaseUrl(url: string) {
  const result = baseUrlValue.set(url);
  if (result.persisted) {
    clearPersistenceNotice("server");
  } else {
    reportPersistenceFailure(
      "server",
      "This server is available for this session, but its address could not be saved for the next restart. Check browser storage and try again.",
    );
  }
  return result;
}

export function clearBaseUrl() {
  const result = baseUrlValue.clear();
  if (result.persisted) {
    clearPersistenceNotice("server");
  } else {
    reportPersistenceFailure(
      "server",
      "The saved server address could not be removed. Check browser storage before configuring another server.",
    );
  }
  return result;
}

export function useBaseUrl(): string | null {
  return usePersistentValue(baseUrlValue);
}
