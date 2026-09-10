import { type FormEvent, useEffect, useState } from "react";
import { http } from "../api/client";
import { getInfo, getUser, login } from "../api/endpoints";
import { isUnauthorized } from "../api/errors";
import { createHttp, normalizeBaseUrl } from "../api/http";
import { logOut, setToken } from "../auth/authStore";
import { isTotpRequired } from "../auth/totp";
import { baseUrlValue, useBaseUrl } from "../settings/settingsStore";
import { Icon } from "../ui/icons/Icon";
import styles from "./SetupScreen.module.css";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/*
 * Vikunja's /info already returns the version with its "v" - "v2.5.0" - so
 * prefixing another one printed "vv2.5.0" in the login banner. Not every
 * deployment is guaranteed to, though (a dev build reports a bare commit-ish
 * string), so normalise rather than just dropping the prefix here.
 */
export function displayVersion(version: string): string {
  const bare = version.trim().replace(/^v/i, "");
  return `v${bare}`;
}

/** Step 1: which Vikunja instance. Probes /info so a typo fails here, not later. */
function ServerStep({ onDone }: { onDone: (url: string, version: string) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = normalizeBaseUrl(url);
    if (!candidate) return;

    setBusy(true);
    setError(null);
    try {
      // Probe with a throwaway client: the shared one reads the stored URL,
      // which we only want to write once the probe succeeds.
      const probe = createHttp({ getBaseUrl: () => candidate, getToken: () => null });
      const info = await getInfo(probe);
      onDone(candidate, info.version);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1 className={styles.brand}>open-todo</h1>
      <p className={styles.lede}>Connect to your Vikunja server to get started.</p>

      <label className={styles.field}>
        <span className={styles.label}>Server URL</span>
        <input
          className={styles.input}
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="https://vikunja.example"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>

      <button className={styles.primary} type="submit" disabled={busy || !url.trim()}>
        {busy ? "Checking…" : "Continue"}
      </button>

      {error ? <p className={styles.error}>{error}</p> : null}
      <p className={styles.hint}>
        This browser talks to Vikunja directly, so the server must list this page's origin
        under <code>cors.origins</code>.
      </p>
    </form>
  );
}

/** Step 2: a credential — username/password, or a pasted API token. */
function LoginStep({
  baseUrl,
  initialVersion,
}: {
  baseUrl: string;
  initialVersion: string | null;
}) {
  const [version, setVersion] = useState(initialVersion);
  const [mode, setMode] = useState<"password" | "token">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [apiToken, setApiToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    mode === "password"
      ? username.trim() !== "" && password !== ""
      : apiToken.trim() !== "";

  // On a reload the URL is already stored, so re-probe to show the version.
  useEffect(() => {
    if (version) return;
    let cancelled = false;
    getInfo(http)
      .then((info) => {
        if (!cancelled) setVersion(info.version);
      })
      .catch(() => {
        // The banner simply omits the version; login can still be attempted.
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await login(http, {
        username: username.trim(),
        password,
        long_token: true,
        ...(needsTotp && totp ? { totp_passcode: totp.trim() } : {}),
      });
      setToken(token);
    } catch (e) {
      if (isTotpRequired(e)) {
        setNeedsTotp(true);
        setError("Enter the code from your authenticator app.");
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitToken(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const candidate = apiToken.trim();
    try {
      // Verify with a throwaway client BEFORE storing. Storing first would
      // flip the App gate, remount this screen, and lose the error message on
      // the way back — the user would see the form reset with no explanation.
      const probe = createHttp({
        getBaseUrl: () => baseUrl,
        getToken: () => candidate,
      });
      await getUser(probe);
      setToken(candidate);
    } catch (e) {
      // 401 means the credential was rejected. Anything else - notably a 403
      // from a scoped API token that may read tasks but not /user - means it
      // authenticated fine, so it is accepted; the app already tolerates
      // /user failing (see queries/useVikunja.ts).
      if (!isUnauthorized(e)) {
        setToken(candidate);
        return;
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={mode === "password" ? submitPassword : submitToken}>
      <h1 className={styles.brand}>Log in</h1>
      {/* The tick means "we reached this server", so it waits for /info. */}
      <p className={styles.server}>
        {version ? <Icon name="check" size={16} className={styles.ok} /> : null}
        {baseUrl}
        {version ? ` · ${displayVersion(version)}` : ""}
      </p>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${mode === "password" ? styles.tabActive : ""}`}
          onClick={() => setMode("password")}
        >
          Username
        </button>
        <button
          type="button"
          className={`${styles.tab} ${mode === "token" ? styles.tabActive : ""}`}
          onClick={() => setMode("token")}
        >
          API token
        </button>
      </div>

      {mode === "password" ? (
        <>
          <label className={styles.field}>
            <span className={styles.label}>Username</span>
            <input
              className={styles.input}
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Password</span>
            <input
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {needsTotp ? (
            <label className={styles.field}>
              <span className={styles.label}>Authenticator code</span>
              <input
                className={styles.input}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
              />
            </label>
          ) : null}
        </>
      ) : (
        <label className={styles.field}>
          <span className={styles.label}>API token</span>
          <input
            className={styles.input}
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
          />
        </label>
      )}

      {/*
       * Same guard the server step uses. Without it an empty form submitted,
       * which cost a round-trip and came back with Vikunja's own wording -
       * "missing, malformed, expired or otherwise invalid token provided" -
       * for a field the user had simply not filled in yet.
       * The password is checked untrimmed: leading and trailing spaces are
       * part of a password, so trimming to test emptiness would reject a
       * legitimate one made only of spaces.
       */}
      <button className={styles.primary} type="submit" disabled={busy || !canSubmit}>
        {busy ? "Signing in…" : "Log in"}
      </button>

      {error ? <p className={styles.error}>{error}</p> : null}

      <button
        type="button"
        className={styles.secondary}
        onClick={() => {
          // Drop the credential FIRST. Clearing only the URL leaves a valid
          // token in the gate, so typing a new host would skip the login form
          // entirely and send the previous server's bearer token to whatever
          // was typed - including a typo.
          logOut();
          baseUrlValue.clear();
        }}
      >
        Use a different server
      </button>
    </form>
  );
}

export function SetupScreen() {
  const baseUrl = useBaseUrl();
  const [version, setVersion] = useState<string | null>(null);

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        {baseUrl ? (
          <LoginStep baseUrl={baseUrl} initialVersion={version} />
        ) : (
          <ServerStep
            onDone={(url, probedVersion) => {
              setVersion(probedVersion);
              baseUrlValue.set(url);
            }}
          />
        )}
      </div>
    </div>
  );
}
