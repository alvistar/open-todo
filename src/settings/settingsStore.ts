import { normalizeBaseUrl } from "../api/http";
import { createPersistentValue, usePersistentValue } from "../store/persistentValue";

/**
 * The Vikunja instance this browser talks to. There is no proxy (D5 revised),
 * so the URL is a per-install setting the user supplies on first run.
 */
export const baseUrlValue = createPersistentValue("open-todo.baseUrl", normalizeBaseUrl);

export function getBaseUrl(): string | null {
  return baseUrlValue.get();
}

export function useBaseUrl(): string | null {
  return usePersistentValue(baseUrlValue);
}
