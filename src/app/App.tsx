import type { ReactNode } from "react";
import { logOut, useToken } from "../auth/authStore";
import { DesktopLifecycleBridge } from "../lifecycle/useDesktopLifecycle";
import { AppScreen } from "../screens/AppScreen";
import { SetupScreen } from "../screens/SetupScreen";
import { TransportConsentScreen } from "../screens/TransportConsentScreen";
import { useBaseUrl } from "../settings/settingsStore";
import {
  requiresTransportConsent,
  serverOrigin,
  useTransportConsent,
} from "../settings/transportPolicy";
import { usePersistenceNotice } from "../store/persistenceNotice";
import { OverlayStackProvider } from "../ui/overlayStack";
import styles from "./App.module.css";

/**
 * The gate: no server URL or no credential means the setup screen. A 401
 * anywhere clears the token (see api/client.ts), which lands back here.
 * Sensitive requests to an HTTP instance also stop here until the user has
 * approved that exact origin.
 */
export function App() {
  const baseUrl = useBaseUrl();
  const token = useToken();
  const consentOrigin = useTransportConsent();
  const persistenceNotice = usePersistenceNotice();

  let content: ReactNode;
  if (!baseUrl || !token) {
    content = <SetupScreen />;
  } else if (
    requiresTransportConsent(baseUrl) &&
    serverOrigin(baseUrl) !== consentOrigin
  ) {
    content = (
      <TransportConsentScreen baseUrl={baseUrl} onAccept={() => {}} onDecline={logOut} />
    );
  } else {
    content = <AppScreen />;
  }

  return (
    <OverlayStackProvider>
      {content}
      {persistenceNotice ? (
        <p className={styles.notice} role="alert">
          {persistenceNotice}
        </p>
      ) : null}
      <DesktopLifecycleBridge />
    </OverlayStackProvider>
  );
}
