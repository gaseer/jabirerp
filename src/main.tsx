import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { QueryProvider } from "./providers/QueryProvider";
import "./index.css";

// Prompt-based SW updates; auto-refresh on new version for simplicity in Slice 0.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryProvider>
      <App />
    </QueryProvider>
  </StrictMode>,
);
