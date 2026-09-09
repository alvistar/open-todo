import { afterEach, describe, expect, it, vi } from "vitest";
import { createPersistentValue } from "./persistentValue";

afterEach(() => localStorage.clear());

describe("createPersistentValue", () => {
  it("starts from what is already stored", () => {
    localStorage.setItem("k", "stored");
    expect(createPersistentValue("k").get()).toBe("stored");
  });

  it("writes through and notifies subscribers", () => {
    const value = createPersistentValue("k");
    const listener = vi.fn();
    value.subscribe(listener);

    value.set("a");
    expect(value.get()).toBe("a");
    expect(localStorage.getItem("k")).toBe("a");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the value is unchanged", () => {
    const value = createPersistentValue("k");
    value.set("a");
    const listener = vi.fn();
    value.subscribe(listener);
    value.set("a");
    expect(listener).not.toHaveBeenCalled();
  });

  it("normalises on write", () => {
    const value = createPersistentValue("k", (v) => v.trim().toLowerCase());
    value.set("  HeLLo  ");
    expect(value.get()).toBe("hello");
  });

  it("clears the key", () => {
    const value = createPersistentValue("k");
    value.set("a");
    value.clear();
    expect(value.get()).toBeNull();
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("picks up a change made in another tab", () => {
    const value = createPersistentValue("k");
    const listener = vi.fn();
    value.subscribe(listener);

    localStorage.setItem("k", "from-other-tab");
    window.dispatchEvent(new StorageEvent("storage", { key: "k" }));

    expect(value.get()).toBe("from-other-tab");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores storage events for other keys", () => {
    const value = createPersistentValue("k");
    const listener = vi.fn();
    value.subscribe(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(listener).not.toHaveBeenCalled();
  });

  it("still works when localStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const value = createPersistentValue("k");
    expect(() => value.set("a")).not.toThrow();
    expect(value.get()).toBe("a");
    spy.mockRestore();
  });
});
