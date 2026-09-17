import { describe, expect, it } from "vitest";
import { getDraftSummary, registerDraftSource, updateDraftSource } from "./drafts";

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
