import { useState } from "react";
import { acceptTransportRisk, serverOrigin } from "../settings/transportPolicy";
import { Icon } from "../ui/icons/Icon";
import { useOverlayLayer } from "../ui/overlayStack";
import styles from "./TransportConsentScreen.module.css";

export interface TransportConsentScreenProps {
  baseUrl: string;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * The gate for a stored session on an explicitly configured HTTP server.
 * Nothing with a credential is sent until the user confirms this origin.
 */
export function TransportConsentScreen({
  baseUrl,
  onAccept,
  onDecline,
}: TransportConsentScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const origin = serverOrigin(baseUrl) ?? baseUrl;
  useOverlayLayer("alertdialog", onDecline);

  return (
    <div className={styles.root}>
      <div className={styles.card} role="alertdialog" aria-labelledby="transport-title">
        <div className={styles.icon} aria-hidden="true">
          <Icon name="warning" size={24} />
        </div>
        <h1 className={styles.title} id="transport-title">
          This connection is not encrypted
        </h1>
        <p className={styles.body}>
          <strong>{origin}</strong> uses HTTP. Anyone who can observe this network may
          read the credentials and task data sent between open-todo and Vikunja.
        </p>
        <p className={styles.body}>
          HTTPS is recommended. Continue only when you deliberately configured this local
          or private server to use HTTP.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onDecline}>
            Use a different server
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              const result = acceptTransportRisk(baseUrl);
              if (!result.persisted && !serverOrigin(baseUrl)) {
                setError("That server address is not a valid HTTP origin.");
                return;
              }
              onAccept();
            }}
          >
            <Icon name="check" size={16} />
            Use HTTP for this server
          </button>
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </div>
  );
}
