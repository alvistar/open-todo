import { describe, expect, it } from "vitest";
import { NetworkError, VikunjaError } from "../api/errors";
import { isTotpRequired } from "./totp";

describe("isTotpRequired", () => {
  it("recognises Vikunja's TOTP error code", () => {
    expect(isTotpRequired(new VikunjaError("invalid", 412, 1017))).toBe(true);
  });

  it("recognises a TOTP message when the code is missing", () => {
    expect(isTotpRequired(new VikunjaError("Invalid TOTP passcode.", 412))).toBe(true);
    expect(isTotpRequired(new VikunjaError("two-factor required", 412))).toBe(true);
  });

  it("treats a plain wrong password as not TOTP", () => {
    expect(isTotpRequired(new VikunjaError("Wrong username or password.", 412))).toBe(
      false,
    );
  });

  it("is false for non-API errors", () => {
    expect(isTotpRequired(new NetworkError("offline"))).toBe(false);
    expect(isTotpRequired(new Error("boom"))).toBe(false);
    expect(isTotpRequired(null)).toBe(false);
  });
});
