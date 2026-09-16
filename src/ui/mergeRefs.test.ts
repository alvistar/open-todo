/*
 * Two owners, one node.
 *
 * The list has held `rowRef` since D4 step 2 — it is how the roving tabindex
 * focuses a row — and dnd-kit's `setNodeRef` wants the same element. Widening
 * TaskRow to take two refs would push that accident into the component's API,
 * so they are merged where both are in scope instead.
 */
import { describe, expect, it, vi } from "vitest";
import { mergeRefs } from "./mergeRefs";

describe("mergeRefs", () => {
  const node = { tagName: "DIV" } as HTMLDivElement;

  it("calls every callback ref", () => {
    const a = vi.fn();
    const b = vi.fn();
    mergeRefs(a, b)(node);
    expect(a).toHaveBeenCalledWith(node);
    expect(b).toHaveBeenCalledWith(node);
  });

  it("assigns every object ref", () => {
    const a = { current: null as HTMLDivElement | null };
    const b = { current: null as HTMLDivElement | null };
    mergeRefs(a, b)(node);
    expect(a.current).toBe(node);
    expect(b.current).toBe(node);
  });

  it("passes the unmount null on to both", () => {
    // React calls the ref with null on unmount, and a ref that never hears it
    // keeps the detached node alive — which for the list's map of rows is a
    // leak that grows with every completed task.
    const a = vi.fn();
    const b = { current: node as HTMLDivElement | null };
    mergeRefs(a, b)(null);
    expect(a).toHaveBeenCalledWith(null);
    expect(b.current).toBeNull();
  });

  it("ignores the refs that are not there", () => {
    const present = vi.fn<(value: HTMLDivElement | null) => void>();
    expect(() => mergeRefs<HTMLDivElement>(undefined, null, present)(node)).not.toThrow();
    expect(present).toHaveBeenCalledWith(node);
  });

  it("mixes the two kinds", () => {
    const callback = vi.fn();
    const object = { current: null as HTMLDivElement | null };
    mergeRefs(callback, object)(node);
    expect(callback).toHaveBeenCalledWith(node);
    expect(object.current).toBe(node);
  });
});
