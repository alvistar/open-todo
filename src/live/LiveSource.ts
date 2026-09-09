import type { Task } from "../api/types";

/**
 * What the UI learns about changes on the server, independent of how they were
 * discovered.
 *
 * D6: v1 discovers them by polling, because Vikunja's WebSocket carries only
 * `notification.created` and `timer.*` — task events exist on the internal bus
 * but are not exposed (mapping §7). This interface is the seam that lets a
 * WebSocketSource replace PollingSource without the UI noticing.
 */
export type LiveEvent =
  | { type: "upsert"; tasks: Task[] }
  | { type: "delete"; ids: number[] }
  | { type: "reset"; tasks: Task[] };

export interface LiveSource {
  /** Begins observing. Idempotent. */
  start(): void;
  /** Stops observing and releases listeners. Idempotent. */
  stop(): void;
  /** Forces a full reconciliation now, e.g. after the app's own mutation. */
  refreshNow(): void;
  subscribe(listener: (event: LiveEvent) => void): () => void;
}
