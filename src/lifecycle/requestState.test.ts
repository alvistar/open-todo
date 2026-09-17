import { describe, expect, it } from "vitest";
import { type LifecycleRequest, transitionRequest } from "./requestState";

const closeA: LifecycleRequest = { attemptId: 4, generation: 2, kind: "close" };
const quitB: LifecycleRequest = { attemptId: 5, generation: 2, kind: "quit" };

describe("lifecycle request reconciliation", () => {
  it("NEW-2 keeps B current when A settles after B was received", () => {
    const afterB = transitionRequest(
      { current: closeA, received: closeA },
      { type: "native-request", request: quitB },
    );
    const afterA = transitionRequest(afterB, {
      type: "response-settled",
      request: closeA,
    });

    expect(afterA.current).toEqual(quitB);
  });
});
