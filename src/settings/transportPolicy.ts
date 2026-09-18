import {
  clearPersistenceNotice,
  reportPersistenceFailure,
} from "../store/persistenceNotice";
import { createPersistentValue, usePersistentValue } from "../store/persistentValue";

/** One acknowledgement is kept, and it is always tied to this exact origin. */
export const transportConsentValue = createPersistentValue(
  "open-todo.insecureTransportOrigin",
  normalizeOrigin,
);

export function serverOrigin(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

export function requiresTransportConsent(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === "http:";
  } catch {
    return false;
  }
}

export function hasTransportConsent(baseUrl: string): boolean {
  if (!requiresTransportConsent(baseUrl)) return true;
  const origin = serverOrigin(baseUrl);
  return origin !== null && transportConsentValue.get() === origin;
}

export function acceptTransportRisk(baseUrl: string) {
  const origin = serverOrigin(baseUrl);
  if (!origin || !requiresTransportConsent(baseUrl)) {
    return {
      persisted: false,
      error: new Error("The server URL is not a valid HTTP origin."),
    };
  }
  const result = transportConsentValue.set(origin);
  if (result.persisted) {
    clearPersistenceNotice("transport");
  } else {
    reportPersistenceFailure(
      "transport",
      "HTTP access is approved for this session, but that approval could not be saved for the next restart. Check browser storage and review the connection before signing in again.",
    );
  }
  return result;
}

export function clearTransportRisk() {
  const result = transportConsentValue.clear();
  if (result.persisted) {
    clearPersistenceNotice("transport");
  } else {
    reportPersistenceFailure(
      "transport",
      "The saved HTTP approval could not be removed. Check browser storage before relying on this device's connection settings.",
    );
  }
  return result;
}

export function useTransportConsent(): string | null {
  return usePersistentValue(transportConsentValue);
}

function normalizeOrigin(value: string): string {
  const origin = serverOrigin(value);
  return origin ?? value.trim();
}
