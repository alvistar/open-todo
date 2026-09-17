import { describe, expect, it } from "vitest";
import { transitionRequest } from "./requestState";

const closeA = {
  attemptId: 4,
  generation: 2,
  kind: "close",
  requestSequence: 0,
} as const;
const quitB = {
  attemptId: 5,
  generation: 2,
  kind: "quit",
  requestSequence: 0,
} as const;

describe("lifecycle request reconciliation", () => {
  it("NEW-2 keeps B current when A settles after B was received", () => {
    const afterB = transitionRequest(
      { current: closeA, inFlight: null, responseError: null },
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

  it("S3 keeps a recheck current when the first response settles", () => {
    const recheck = { ...closeA, requestSequence: 1 } as const;
    const settled = transitionRequest(
      {
        current: recheck,
        inFlight: { request: closeA, responseId: 1 },
        responseError: null,
      },
      {
        type: "response-settled",
        request: closeA,
        responseId: 1,
        error: null,
      },
    );

    expect(settled.current).toEqual(recheck);
  });
});
