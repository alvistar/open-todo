import { describe, expect, it } from "vitest";
import { type LifecycleRequest, transitionRequest } from "./requestState";

const closeA: LifecycleRequest = { attemptId: 4, generation: 2, kind: "close" };
const quitB: LifecycleRequest = { attemptId: 5, generation: 2, kind: "quit" };

describe("lifecycle request reconciliation", () => {
  it("NEW-2 keeps B current when A settles after B was received", () => {
    const afterB = transitionRequest(
      { current: closeA, received: closeA, inFlight: null, responseError: null },
      { type: "native-request", request: quitB },
    );
    const afterA = transitionRequest(afterB, {
      type: "response-started",
      request: closeA,
      responseId: 1,
    });
    const settled = transitionRequest(afterA, {
      type: "response-settled",
      request: closeA,
      responseId: 1,
      error: null,
    });

    expect(settled.current).toEqual(quitB);
  });
});
