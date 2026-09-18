import { describe, expect, it } from "vitest";
import { sameRequest, transitionRequest } from "./requestState";

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

  it("ignores a settlement from a superseded response id", () => {
    const state = {
      current: closeA,
      inFlight: { request: closeA, responseId: 2 },
      responseError: null,
    };
    const settled = transitionRequest(state, {
      type: "response-settled",
      request: closeA,
      responseId: 1,
      error: "stale failure",
    });

    expect(settled).toBe(state);
  });

  it("surfaces a failed response for the request still on screen", () => {
    const started = transitionRequest(
      { current: closeA, inFlight: null, responseError: null },
      { type: "response-started", request: closeA, responseId: 1 },
    );
    const settled = transitionRequest(started, {
      type: "response-settled",
      request: closeA,
      responseId: 1,
      error: "The desktop action could not be completed.",
    });

    expect(settled.current).toBeNull();
    expect(settled.inFlight).toBeNull();
    expect(settled.responseError).toBe("The desktop action could not be completed.");
  });

  it("clears a previous error when a new native request or response starts", () => {
    const withError = {
      current: null,
      inFlight: null,
      responseError: "old failure",
    };
    expect(
      transitionRequest(withError, { type: "native-request", request: closeA })
        .responseError,
    ).toBeNull();
    expect(
      transitionRequest(withError, {
        type: "response-started",
        request: closeA,
        responseId: 1,
      }).responseError,
    ).toBeNull();
  });

  it("never treats a missing request as the same request", () => {
    expect(sameRequest(null, null)).toBe(false);
    expect(sameRequest(closeA, null)).toBe(false);
    expect(sameRequest(null, closeA)).toBe(false);
    expect(sameRequest(closeA, closeA)).toBe(true);
    expect(sameRequest(closeA, quitB)).toBe(false);
    expect(sameRequest(closeA, { ...closeA, generation: 3 })).toBe(false);
  });
});
