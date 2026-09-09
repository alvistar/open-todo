import { afterEach, describe, expect, it } from "vitest";
import { baseUrlValue } from "../settings/settingsStore";
import { getToken, logOut, setToken } from "./authStore";

afterEach(() => {
  logOut();
  baseUrlValue.clear();
});

describe("credential lifecycle", () => {
  it("stores and clears the token", () => {
    setToken("tk_1");
    expect(getToken()).toBe("tk_1");
    logOut();
    expect(getToken()).toBeNull();
  });

  it("switching server must not leave a credential behind", () => {
    // The gate renders the app whenever BOTH a URL and a token are present.
    // If "use a different server" clears only the URL, typing a new host
    // skips login and sends the old server's bearer token to it.
    baseUrlValue.set("https://old.example");
    setToken("tk_for_old_server");

    logOut();
    baseUrlValue.clear();

    baseUrlValue.set("https://new.example");
    expect(getToken()).toBeNull();
  });
});
