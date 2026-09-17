import { useEffect, useSyncExternalStore } from "react";

export interface DraftSource {
  id: string;
  label: string;
  dirty: boolean;
  pending: boolean;
  error?: string;
}

export interface DraftSummary {
  dirty: boolean;
  pending: boolean;
  sources: readonly DraftSource[];
  errors: readonly DraftSource[];
}

const sources = new Map<string, DraftSource>();
const listeners = new Set<() => void>();
let nextPendingId = 0;
let snapshot: DraftSummary = { dirty: false, pending: false, sources: [], errors: [] };

function emit(): void {
  const nextSources = [...sources.values()].filter(
    (source) => source.dirty || source.pending || source.error !== undefined,
  );
  const next: DraftSummary = {
    dirty: nextSources.some((source) => source.dirty),
    pending: nextSources.some((source) => source.pending),
    sources: nextSources,
    errors: nextSources.filter((source) => source.error !== undefined),
  };
  if (
    next.dirty === snapshot.dirty &&
    next.pending === snapshot.pending &&
    next.sources.length === snapshot.sources.length &&
    next.sources.every((source, index) => source === snapshot.sources[index])
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

export function registerDraftSource(source: DraftSource): () => void {
  sources.set(source.id, source);
  emit();
  return () => {
    if (!sources.delete(source.id)) return;
    emit();
  };
}

export function updateDraftSource(
  id: string,
  state: Pick<DraftSource, "dirty" | "pending">,
): void {
  const current = sources.get(id);
  if (!current) return;
  if (current.dirty === state.dirty && current.pending === state.pending) return;
  sources.set(id, { ...current, ...state });
  emit();
}

/**
 * Keeps an in-flight write in the lifecycle registry after its component has
 * unmounted. Rejected detached writes remain as dirty errors until the next
 * write or an explicit lifecycle cleanup clears them; successful writes leave
 * no registry entry.
 */
export function registerPendingDraft(
  label: string,
  promise: Promise<unknown>,
): () => void {
  const id = `pending:${nextPendingId++}`;
  sources.set(id, { id, label, dirty: false, pending: true });
  emit();

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (sources.delete(id)) emit();
  };
  void promise.then(
    () => {
      if (sources.delete(id)) emit();
    },
    (reason: unknown) => {
      const current = sources.get(id);
      if (!current) return;
      sources.set(id, {
        ...current,
        dirty: true,
        pending: false,
        error: reason instanceof Error ? reason.message : "Could not save the change.",
      });
      emit();
    },
  );
  return release;
}

/** Clears detached write failures after the user has acknowledged them. */
export function clearDraftErrors(): void {
  let changed = false;
  for (const [id, source] of sources) {
    if (source.error === undefined) continue;
    sources.delete(id);
    changed = true;
  }
  if (changed) emit();
}

export function getDraftSummary(): DraftSummary {
  return snapshot;
}

export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDraftSummary(): DraftSummary {
  return useSyncExternalStore(subscribeDrafts, getDraftSummary, getDraftSummary);
}

/** Registers a component's current unsaved and in-flight work. */
export function useDraftSource(
  id: string,
  label: string,
  dirty: boolean,
  pending: boolean,
): void {
  useEffect(
    () => registerDraftSource({ id, label, dirty: false, pending: false }),
    [id, label],
  );
  useEffect(() => updateDraftSource(id, { dirty, pending }), [id, dirty, pending]);
}
