import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./theme/base.css";
import { applyTheme, readThemePreference } from "./theme/theme";

applyTheme(readThemePreference());

const container = document.getElementById("root");
if (!container) throw new Error("#root not found in index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
