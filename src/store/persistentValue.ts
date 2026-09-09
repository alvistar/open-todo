import { useSyncExternalStore } from "react";

export interface PersistentValue {
  get(): string | null;
  set(value: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

/**
 * A single string in localStorage, observable by React.
 *
 * Every access is guarded: a browser with site data blocked throws on the
 * accessor itself, and the app must still run (unauthenticated, but running).
 * Changes from another tab arrive through the `storage` event.
 */
export function createPersistentValue(
  key: string,
  normalize: (value: string) => string = (v) => v,
): PersistentValue {
  const listeners = new Set<() => void>();
  // Mirrors localStorage so reads stay cheap and survive a blocked accessor.
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(key);
  } catch {
    cached = null;
  }

  function emit(): void {
    for (const listener of listeners) listener();
  }

  return {
    get: () => cached,

    set(value: string) {
      const normalized = normalize(value);
      if (normalized === cached) return;
      cached = normalized;
      try {
        localStorage.setItem(key, normalized);
      } catch {
        // Value still applies for this page view.
      }
      emit();
    },

    clear() {
      if (cached === null) return;
      cached = null;
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
      emit();
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== key) return;
        let next: string | null = null;
        try {
          next = localStorage.getItem(key);
        } catch {
          next = null;
        }
        if (next !== cached) {
          cached = next;
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
