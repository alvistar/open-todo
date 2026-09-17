import { useSyncExternalStore } from "react";

export interface PersistenceResult {
  /** True when the requested value is known to have reached storage. */
  persisted: boolean;
  error: unknown | null;
}

export interface PersistenceStatus {
  /** False when the current in-memory value may not survive a restart. */
  durable: boolean;
  error: unknown | null;
  operation: "set" | "clear" | null;
}

export interface PersistentValue {
  get(): string | null;
  set(value: string): PersistenceResult;
  clear(): PersistenceResult;
  getStatus(): PersistenceStatus;
  subscribe(listener: () => void): () => void;
}

/**
 * A single string in localStorage, observable by React.
 *
 * Every access is guarded: a browser with site data blocked throws on the
 * accessor itself, and the app must still run (unauthenticated, but running).
 * Changes from another tab arrive through the `storage` event.
 *
 * The cached value and the last known durable value are tracked separately.
 * That distinction matters when a write fails: setting the same value again is
 * still a retry, and clearing an already-null cache can still retry a failed
 * removal.
 */
export function createPersistentValue(
  key: string,
  normalize: (value: string) => string = (v) => v,
): PersistentValue {
  const listeners = new Set<() => void>();
  // Mirrors localStorage so reads stay cheap and survive a blocked accessor.
  let cached: string | null = null;
  // undefined means storage could not be read or the last write outcome is
  // unknown. It is intentionally different from a durable null.
  let durable: string | null | undefined;
  let lastError: unknown | null = null;
  let lastOperation: PersistenceStatus["operation"] = null;

  try {
    cached = localStorage.getItem(key);
    durable = cached;
  } catch (error) {
    cached = null;
    durable = undefined;
    lastError = error;
  }

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function result(persisted: boolean, error: unknown | null): PersistenceResult {
    return { persisted, error };
  }

  return {
    get: () => cached,

    set(value: string) {
      const normalized = normalize(value);
      const changed = normalized !== cached;
      const needsWrite = durable !== normalized;
      cached = normalized;
      lastOperation = "set";

      if (!needsWrite) {
        lastError = null;
        if (changed) emit();
        return result(true, null);
      }

      try {
        localStorage.setItem(key, normalized);
        durable = normalized;
        lastError = null;
        if (changed) emit();
        return result(true, null);
      } catch (error) {
        durable = undefined;
        lastError = error;
        if (changed) emit();
        return result(false, error);
      }
    },

    clear() {
      const changed = cached !== null;
      const needsRemoval = durable !== null;
      cached = null;
      lastOperation = "clear";

      if (!needsRemoval) {
        lastError = null;
        if (changed) emit();
        return result(true, null);
      }

      try {
        localStorage.removeItem(key);
        durable = null;
        lastError = null;
        if (changed) emit();
        return result(true, null);
      } catch (error) {
        durable = undefined;
        lastError = error;
        if (changed) emit();
        return result(false, error);
      }
    },

    getStatus: () => ({
      durable: durable !== undefined && durable === cached,
      error: lastError,
      operation: lastOperation,
    }),

    subscribe(listener: () => void) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== key) return;
        let next: string | null = null;
        try {
          next = localStorage.getItem(key);
          durable = next;
          lastError = null;
        } catch (error) {
          durable = undefined;
          lastError = error;
        }
        if (next !== cached) {
          cached = next;
          lastOperation = null;
          emit();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

/** Subscribes a component to a persistent value. */
export function usePersistentValue(value: PersistentValue): string | null {
  return useSyncExternalStore(value.subscribe, value.get, value.get);
}
