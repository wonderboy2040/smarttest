import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";

createRoot(document.getElementById("root")!).render(
<StrictMode>
<ErrorBoundary>
<ToastProvider>
<App />
</ToastProvider>
</ErrorBoundary>
</StrictMode>
);

// --- PWA: register service worker for installability + offline shell ---
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("SW registration failed:", err);
    });
  });
}
