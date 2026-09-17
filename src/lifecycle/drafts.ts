import { useEffect, useSyncExternalStore } from "react";

export interface DraftSource {
  id: string;
  label: string;
  dirty: boolean;
  pending: boolean;
}

export interface DraftSummary {
  dirty: boolean;
  pending: boolean;
  sources: readonly DraftSource[];
}

const sources = new Map<string, DraftSource>();
const listeners = new Set<() => void>();
let snapshot: DraftSummary = { dirty: false, pending: false, sources: [] };

function emit(): void {
  const nextSources = [...sources.values()].filter(
    (source) => source.dirty || source.pending,
  );
  const next: DraftSummary = {
    dirty: nextSources.some((source) => source.dirty),
    pending: nextSources.some((source) => source.pending),
    sources: nextSources,
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
