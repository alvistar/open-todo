import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenValue } from "../auth/authStore";
import { baseUrlValue } from "../settings/settingsStore";
import { acceptTransportRisk, transportConsentValue } from "../settings/transportPolicy";
import { App } from "./App";

vi.mock("../screens/AppScreen", () => ({
  AppScreen: () => <div data-testid="app-screen">App screen</div>,
}));
vi.mock("../screens/SetupScreen", () => ({
  SetupScreen: () => <div data-testid="setup-screen">Setup screen</div>,
}));

beforeEach(() => {
  tokenValue.clear();
  transportConsentValue.clear();
  baseUrlValue.clear();
  localStorage.clear();
});

afterEach(() => {
  tokenValue.clear();
  transportConsentValue.clear();
  baseUrlValue.clear();
  localStorage.clear();
});

describe("App gates", () => {
  it("shows setup without a stored session", () => {
    render(<App />);
    expect(screen.getByTestId("setup-screen")).toBeInTheDocument();
  });

  it("requires consent before starting a stored HTTP session", async () => {
    baseUrlValue.set("http://vikunja.lan:3456");
    tokenValue.set("token");
    render(<App />);

    expect(screen.getByRole("alertdialog")).toHaveTextContent("not encrypted");
    expect(screen.queryByTestId("app-screen")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Use HTTP for this server/ }));
    await waitFor(() => expect(screen.getByTestId("app-screen")).toBeInTheDocument());
  });

  it("does not reuse approval for another origin", () => {
    acceptTransportRisk("http://first.vikunja.lan:3456");
    baseUrlValue.set("http://second.vikunja.lan:3456");
    tokenValue.set("token");
    render(<App />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("second.vikunja.lan");
  });

  it("starts a stored HTTPS session without an extra gate", () => {
    baseUrlValue.set("https://vikunja.example");
    tokenValue.set("token");
    render(<App />);
    expect(screen.getByTestId("app-screen")).toBeInTheDocument();
  });
});
