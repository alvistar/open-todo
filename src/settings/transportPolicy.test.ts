import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptTransportRisk,
  clearTransportRisk,
  hasTransportConsent,
  requiresTransportConsent,
  serverOrigin,
  transportConsentValue,
} from "./transportPolicy";

afterEach(() => {
  vi.restoreAllMocks();
  transportConsentValue.clear();
  localStorage.clear();
});

describe("transport policy", () => {
  it("defaults to HTTPS without requiring an acknowledgement", () => {
    expect(requiresTransportConsent("https://vikunja.example")).toBe(false);
    expect(hasTransportConsent("https://vikunja.example")).toBe(true);
  });

  it("binds HTTP approval to the exact server origin", () => {
    const server = "http://vikunja.lan:3456";
    expect(requiresTransportConsent(server)).toBe(true);
    expect(hasTransportConsent(server)).toBe(false);

    expect(acceptTransportRisk(server).persisted).toBe(true);
    expect(hasTransportConsent(server)).toBe(true);
    expect(hasTransportConsent("http://other.vikunja.lan:3456")).toBe(false);
    expect(hasTransportConsent("http://vikunja.lan:8080")).toBe(false);
  });

  it("normalises the acknowledgement to URL origin", () => {
    expect(serverOrigin("http://vikunja.lan:3456/api/v1")).toBe(
      "http://vikunja.lan:3456",
    );
    expect(acceptTransportRisk("http://vikunja.lan:3456/api/v1/").persisted).toBe(true);
    expect(transportConsentValue.get()).toBe("http://vikunja.lan:3456");
  });

  it("keeps the current session usable when saving approval fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const server = "http://vikunja.lan:3456";
    expect(acceptTransportRisk(server).persisted).toBe(false);
    expect(hasTransportConsent(server)).toBe(true);
  });

  it("reports failed approval removal without changing another origin", () => {
    const server = "http://vikunja.lan:3456";
    acceptTransportRisk(server);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(clearTransportRisk().persisted).toBe(false);
    expect(hasTransportConsent(server)).toBe(false);
  });
});
