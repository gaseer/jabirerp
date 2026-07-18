import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { QueryProvider } from "./providers/QueryProvider";
import "./index.css";

// Auto-updating service worker: precaches the app shell so the PWA opens
// offline; new versions activate silently on the next launch.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryProvider>
      <App />
    </QueryProvider>
  </StrictMode>,
);
