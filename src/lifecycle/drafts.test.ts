import { describe, expect, it, vi } from "vitest";
import {
  clearDraftErrors,
  getDraftSummary,
  registerDraftSource,
  registerPendingDraft,
  subscribeDrafts,
  updateDraftSource,
} from "./drafts";

describe("draft registry", () => {
  it("aggregates dirty and pending sources", () => {
    const removeComposer = registerDraftSource({
      id: "composer-test",
      label: "Quick add",
      dirty: true,
      pending: false,
    });
    const removeDetail = registerDraftSource({
      id: "detail-test",
      label: "Task detail",
      dirty: false,
      pending: true,
    });

    expect(getDraftSummary()).toMatchObject({ dirty: true, pending: true });
    expect(getDraftSummary().sources.map((source) => source.label)).toEqual([
      "Quick add",
      "Task detail",
    ]);

    removeComposer();
    removeDetail();
    expect(getDraftSummary()).toMatchObject({
      dirty: false,
      pending: false,
      sources: [],
    });
  });

  it("updates a registered source without changing unrelated sources", () => {
    const remove = registerDraftSource({
      id: "editor-test",
      label: "Editor",
      dirty: false,
      pending: false,
    });

    updateDraftSource("editor-test", { dirty: true, pending: false });
    expect(getDraftSummary()).toMatchObject({ dirty: true, pending: false });
    expect(getDraftSummary().sources[0]).toMatchObject({
      id: "editor-test",
      dirty: true,
    });

    updateDraftSource("missing-test", { dirty: true, pending: true });
    expect(getDraftSummary().sources).toHaveLength(1);
    remove();
  });
});

describe("detached pending writes", () => {
  it("keeps a detached write pending and leaves no entry when it succeeds", async () => {
    let settle!: () => void;
    const release = registerPendingDraft(
      "Task detail",
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );

    expect(getDraftSummary()).toMatchObject({ dirty: false, pending: true });
    expect(getDraftSummary().sources[0]).toMatchObject({ label: "Task detail" });

    settle();
    await vi.waitFor(() => expect(getDraftSummary().pending).toBe(false));
    expect(getDraftSummary().sources).toEqual([]);
    release();
  });

  it("turns a rejected detached write into a dismissable error", async () => {
    const release = registerPendingDraft(
      "Task detail",
      Promise.reject(new Error("The server rejected the change.")),
    );

    await vi.waitFor(() => expect(getDraftSummary().errors).toHaveLength(1));
    expect(getDraftSummary()).toMatchObject({ dirty: true, pending: false });
    expect(getDraftSummary().errors[0]?.error).toBe("The server rejected the change.");

    clearDraftErrors();
    expect(getDraftSummary().errors).toEqual([]);
    expect(getDraftSummary().dirty).toBe(false);
    release();
  });

  it("describes a non-Error rejection without leaking its shape", async () => {
    const release = registerPendingDraft("Task detail", Promise.reject("nope"));
    await vi.waitFor(() => expect(getDraftSummary().errors).toHaveLength(1));
    expect(getDraftSummary().errors[0]?.error).toBe("Could not save the change.");
    clearDraftErrors();
    release();
  });

  it("releasing a still-pending write drops it from the registry once", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDrafts(listener);
    const release = registerPendingDraft(
      "Task detail",
      new Promise<void>(() => undefined),
    );
    expect(getDraftSummary().pending).toBe(true);

    release();
    expect(getDraftSummary().pending).toBe(false);
    const calls = listener.mock.calls.length;
    release();
    expect(listener.mock.calls.length).toBe(calls);
    unsubscribe();
  });

  it("clearing errors when there are none notifies nobody", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDrafts(listener);
    clearDraftErrors();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
