export interface LifecycleRequest {
  attemptId: number;
  generation: number;
  kind: "close" | "quit";
  requestSequence: number;
}

export interface RequestState {
  current: LifecycleRequest | null;
  inFlight: { request: LifecycleRequest; responseId: number } | null;
  responseError: string | null;
}

export type RequestEvent =
  | { type: "native-request"; request: LifecycleRequest }
  | {
      type: "response-started";
      request: LifecycleRequest;
      responseId: number;
    }
  | {
      type: "response-settled";
      request: LifecycleRequest;
      responseId: number;
      error: string | null;
    };

export function sameRequest(
  left: LifecycleRequest | null,
  right: LifecycleRequest | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.attemptId === right.attemptId &&
    left.generation === right.generation &&
    left.requestSequence === right.requestSequence
  );
}

export function transitionRequest(
  state: RequestState,
  event: RequestEvent,
): RequestState {
  if (event.type === "native-request") {
    return {
      ...state,
      current: event.request,
      responseError: null,
    };
  }
  if (event.type === "response-started") {
    return {
      ...state,
      inFlight: { request: event.request, responseId: event.responseId },
      responseError: null,
    };
  }
  if (state.inFlight?.responseId !== event.responseId) {
    return state;
  }
  const settled = sameRequest(state.current, event.request);
  return {
    ...state,
    current: settled ? null : state.current,
    inFlight: null,
    responseError: settled ? event.error : null,
  };
}
