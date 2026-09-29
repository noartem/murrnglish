import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { warmCache } from "./offline";
import "overlayscrollbars/overlayscrollbars.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker: the offline course cache. PROD only — under the dev server
// the cached ephemeral assets would churn on every reload, and offline checks
// run against `vite preview` (a real build) instead.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  // The first load's own requests were never seen by the worker (it activates
  // mid-load), so they get cached once it is in charge: the shell right away,
  // then the data this view fetches — the app's fetches start after the load
  // event, which is why the second pass waits a beat before running.
  const loaded = new Promise<void>((done) => {
    if (document.readyState === "complete") done();
    else window.addEventListener("load", () => done(), { once: true });
  });
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then(() => Promise.all([navigator.serviceWorker.ready, loaded]))
    .then(async () => {
      if (await warmCache()) window.setTimeout(() => void warmCache(), 2000);
    })
    .catch(() => {});
}
