export interface LifecycleRequest {
  attemptId: number;
  generation: number;
  kind: "close" | "quit";
}

export interface RequestState {
  current: LifecycleRequest | null;
  received: LifecycleRequest | null;
}

export type RequestEvent =
  | { type: "native-request"; request: LifecycleRequest }
  | { type: "response-settled"; request: LifecycleRequest };

function sameRequest(left: LifecycleRequest | null, right: LifecycleRequest): boolean {
  return (
    left !== null &&
    left.attemptId === right.attemptId &&
    left.generation === right.generation
  );
}

/**
 * This transition intentionally models the old commit-delayed request ref;
 * the reproduction test drives the event ordering that loses request B.
 */
export function transitionRequest(state: RequestState, event: RequestEvent): RequestState {
  if (event.type === "native-request") {
    return { ...state, received: event.request };
  }
  if (sameRequest(state.current, event.request)) {
    return { ...state, current: null };
  }
  return state;
}
