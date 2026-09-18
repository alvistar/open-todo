import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistenceNotice,
  getPersistenceNotice,
  reportPersistenceFailure,
  subscribePersistenceNotice,
} from "./persistenceNotice";

afterEach(() => {
  clearPersistenceNotice("credential");
  clearPersistenceNotice("server");
  clearPersistenceNotice("transport");
});

describe("persistence notice", () => {
  it("starts empty", () => {
    expect(getPersistenceNotice()).toBeNull();
  });

  it("reports a failure and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePersistenceNotice(listener);

    reportPersistenceFailure("credential", "The credential could not be saved.");
    expect(getPersistenceNotice()).toBe("The credential could not be saved.");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    reportPersistenceFailure("server", "The server could not be saved.");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("shows the most recent notice and falls back to the one still open", () => {
    reportPersistenceFailure("credential", "credential failed");
    reportPersistenceFailure("server", "server failed");
    expect(getPersistenceNotice()).toBe("server failed");

    clearPersistenceNotice("server");
    expect(getPersistenceNotice()).toBe("credential failed");

    clearPersistenceNotice("credential");
    expect(getPersistenceNotice()).toBeNull();
  });

  it("replaces the message for a key that already failed", () => {
    reportPersistenceFailure("transport", "first");
    reportPersistenceFailure("transport", "second");
    expect(getPersistenceNotice()).toBe("second");
    clearPersistenceNotice("transport");
    expect(getPersistenceNotice()).toBeNull();
  });

  it("does not notify when clearing a key that has no notice", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePersistenceNotice(listener);
    clearPersistenceNotice("server");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
