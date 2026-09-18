import { useSyncExternalStore } from "react";

const notices = new Map<string, string>();
const listeners = new Set<() => void>();
let current: string | null = null;

function emit(): void {
  current = [...notices.values()].at(-1) ?? null;
  for (const listener of listeners) listener();
}

/** Shows a critical storage failure without claiming that a value is durable. */
export function reportPersistenceFailure(key: string, message: string): void {
  notices.set(key, message);
  emit();
}

/** Clears one consumer's notice after a later operation succeeds. */
export function clearPersistenceNotice(key: string): void {
  if (!notices.delete(key)) return;
  emit();
}

export function getPersistenceNotice(): string | null {
  return current;
}

export function subscribePersistenceNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePersistenceNotice(): string | null {
  return useSyncExternalStore(
    subscribePersistenceNotice,
    getPersistenceNotice,
    getPersistenceNotice,
  );
}
