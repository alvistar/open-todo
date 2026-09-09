import { useToken } from "../auth/authStore";
import { FixtureScreen } from "../screens/FixtureScreen";
import { SetupScreen } from "../screens/SetupScreen";
import { useBaseUrl } from "../settings/settingsStore";

/**
 * The gate: no server URL or no credential means the setup screen. A 401
 * anywhere clears the token (see api/client.ts), which lands back here.
 */
export function App() {
  const baseUrl = useBaseUrl();
  const token = useToken();

  if (!baseUrl || !token) return <SetupScreen />;
  return <FixtureScreen />;
}
