import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayStackProvider } from "../ui/overlayStack";
import { registerDraftSource } from "./drafts";

const mocks = vi.hoisted(() => ({
  eventHandlers: {} as Record<string, (event: { payload: unknown }) => void>,
  invoke: vi.fn(async (_command: string, _args?: unknown): Promise<void> => undefined),
  isTauri: vi.fn(() => true),
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    mocks.eventHandlers[name] = callback;
    return vi.fn();
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import { DesktopLifecycleBridge } from "./useDesktopLifecycle";

const request = { attemptId: 4, generation: 2, kind: "close" as const };

beforeEach(() => {
  mocks.eventHandlers = {};
  mocks.invoke.mockClear();
  mocks.listen.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DesktopLifecycleBridge", () => {
  it("asks before discarding a dirty draft and reports cancellation", async () => {
    const remove = registerDraftSource({
      id: "bridge-dirty",
      label: "Quick add",
      dirty: true,
      pending: false,
    });
    const { unmount } = render(<DesktopLifecycleBridge />);

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("lifecycle_ready", expect.anything()),
    );
    mocks.eventHandlers["lifecycle:request"]?.({ payload: request });
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("unsaved changes");

    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "lifecycle_decision",
        expect.objectContaining({
          payload: expect.objectContaining({
            attemptId: 4,
            decision: "cancel",
            dirty: true,
            pending: false,
          }),
        }),
      ),
    );

    unmount();
    remove();
  });

  it("offers exit anyway while a save is pending", async () => {
    const remove = registerDraftSource({
      id: "bridge-pending",
      label: "Task detail",
      dirty: true,
      pending: true,
    });
    render(<DesktopLifecycleBridge />);

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("lifecycle_ready", expect.anything()),
    );
    mocks.eventHandlers["lifecycle:request"]?.({ payload: request });
    expect(await screen.findByText("A save is still in progress")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Exit anyway" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "lifecycle_decision",
        expect.objectContaining({
          payload: expect.objectContaining({
            decision: "exit-anyway",
            dirty: true,
            pending: true,
          }),
        }),
      ),
    );
    remove();
  });

  it("authorizes a clean request without showing a dialog", async () => {
    const remove = registerDraftSource({
      id: "bridge-clean",
      label: "Clean editor",
      dirty: false,
      pending: false,
    });
    render(<DesktopLifecycleBridge />);

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("lifecycle_ready", expect.anything()),
    );
    mocks.eventHandlers["lifecycle:request"]?.({ payload: request });
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "lifecycle_decision",
        expect.objectContaining({
          payload: expect.objectContaining({
            decision: "allow",
            dirty: false,
            pending: false,
          }),
        }),
      ),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    remove();
  });

  it("keeps a newer request visible when an older response resolves", async () => {
    let resolveA: (() => void) | undefined;
    mocks.invoke.mockImplementation((name: string) => {
      if (name === "lifecycle_decision") {
        return new Promise<void>((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve();
    });
    const removeClean = registerDraftSource({
      id: "bridge-first-clean",
      label: "Clean editor",
      dirty: false,
      pending: false,
    });
    const { unmount } = render(
      <OverlayStackProvider>
        <DesktopLifecycleBridge />
      </OverlayStackProvider>,
    );

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("lifecycle_ready", expect.anything()),
    );
    mocks.eventHandlers["lifecycle:request"]?.({
      payload: { attemptId: 4, generation: 2, kind: "close" },
    });
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "lifecycle_decision",
        expect.objectContaining({
          payload: expect.objectContaining({ attemptId: 4, decision: "allow" }),
        }),
      ),
    );

    const removeDirty = registerDraftSource({
      id: "bridge-second-dirty",
      label: "Task detail",
      dirty: true,
      pending: false,
    });
    mocks.eventHandlers["lifecycle:request"]?.({
      payload: { attemptId: 5, generation: 2, kind: "quit" },
    });
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    resolveA?.();
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "lifecycle_decision",
        expect.objectContaining({
          payload: expect.objectContaining({ attemptId: 5, decision: "cancel" }),
        }),
      ),
    );

    unmount();
    removeDirty();
    removeClean();
  });
});
