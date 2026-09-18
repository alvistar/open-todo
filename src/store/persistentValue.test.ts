import { afterEach, describe, expect, it, vi } from "vitest";
import { createPersistentValue } from "./persistentValue";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("createPersistentValue", () => {
  it("starts from what is already stored", () => {
    localStorage.setItem("k", "stored");
    const value = createPersistentValue("k");
    expect(value.get()).toBe("stored");
    expect(value.getStatus().durable).toBe(true);
  });

  it("writes through and notifies subscribers", () => {
    const value = createPersistentValue("k");
    const listener = vi.fn();
    value.subscribe(listener);

    expect(value.set("a")).toEqual({ persisted: true, error: null });
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
    expect(localStorage.getItem("k")).toBe("hello");
  });

  it("clears the key", () => {
    const value = createPersistentValue("k");
    value.set("a");
    expect(value.clear()).toEqual({ persisted: true, error: null });
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

  it("reports a failed write and retries the same value", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    setItem.mockImplementationOnce(() => {
      throw new Error("quota");
    });
    const value = createPersistentValue("k");

    const first = value.set("a");
    expect(first.persisted).toBe(false);
    expect(value.get()).toBe("a");
    expect(localStorage.getItem("k")).toBeNull();
    expect(value.getStatus().durable).toBe(false);

    const second = value.set("a");
    expect(second).toEqual({ persisted: true, error: null });
    expect(localStorage.getItem("k")).toBe("a");
    expect(value.getStatus().durable).toBe(true);
  });

  it("retries a failed removal even when the cache is already empty", () => {
    const value = createPersistentValue("k");
    value.set("a");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    removeItem.mockImplementationOnce(() => {
      throw new Error("blocked");
    });

    expect(value.clear().persisted).toBe(false);
    expect(value.get()).toBeNull();
    expect(localStorage.getItem("k")).toBe("a");

    expect(value.clear()).toEqual({ persisted: true, error: null });
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("leaves a fresh consumer at the durable value after a failed write", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    const value = createPersistentValue("k");
    value.set("not-durable");
    setItem.mockRestore();

    expect(createPersistentValue("k").get()).toBeNull();
  });

  it("still runs when reading or writing storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const value = createPersistentValue("k");
    expect(value.get()).toBeNull();
    expect(value.getStatus().durable).toBe(false);

    expect(value.set("a").persisted).toBe(false);
    expect(value.get()).toBe("a");
  });
});
