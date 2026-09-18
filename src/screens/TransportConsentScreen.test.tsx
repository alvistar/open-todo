import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasTransportConsent, transportConsentValue } from "../settings/transportPolicy";
import { OverlayStackProvider } from "../ui/overlayStack";
import { TransportConsentScreen } from "./TransportConsentScreen";

beforeEach(() => {
  transportConsentValue.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  transportConsentValue.clear();
  localStorage.clear();
});

describe("TransportConsentScreen", () => {
  it("names the exact origin the approval would cover", () => {
    render(
      <TransportConsentScreen
        baseUrl="http://vikunja.lan:3456/api/v1"
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent("http://vikunja.lan:3456");
  });

  it("records the approval and continues when the user accepts", () => {
    const onAccept = vi.fn();
    render(
      <TransportConsentScreen
        baseUrl="http://vikunja.lan:3456"
        onAccept={onAccept}
        onDecline={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Use HTTP for this server/ }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(hasTransportConsent("http://vikunja.lan:3456")).toBe(true);
  });

  it("declines without approving the origin", () => {
    const onDecline = vi.fn();
    render(
      <TransportConsentScreen
        baseUrl="http://vikunja.lan:3456"
        onAccept={vi.fn()}
        onDecline={onDecline}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use a different server" }));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(hasTransportConsent("http://vikunja.lan:3456")).toBe(false);
  });

  it("declines on Escape through the overlay stack", () => {
    const onDecline = vi.fn();
    render(
      <OverlayStackProvider>
        <TransportConsentScreen
          baseUrl="http://vikunja.lan:3456"
          onAccept={vi.fn()}
          onDecline={onDecline}
        />
      </OverlayStackProvider>,
    );
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("refuses to continue when the configured address is not a valid origin", () => {
    const onAccept = vi.fn();
    render(
      <TransportConsentScreen
        baseUrl="not a url"
        onAccept={onAccept}
        onDecline={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Use HTTP for this server/ }));
    expect(
      screen.getByText("That server address is not a valid HTTP origin."),
    ).toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("continues when the approval is usable for this session but not durable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const onAccept = vi.fn();
    render(
      <TransportConsentScreen
        baseUrl="http://vikunja.lan:3456"
        onAccept={onAccept}
        onDecline={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Use HTTP for this server/ }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(hasTransportConsent("http://vikunja.lan:3456")).toBe(true);
  });
});
