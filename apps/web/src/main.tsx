import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./i18n";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";

// Register download Service Worker (streams OPFS files to native download manager)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/download-sw.js").catch(() => {});
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
