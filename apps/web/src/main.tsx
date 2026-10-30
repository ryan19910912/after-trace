import ReactDOM from "react-dom/client";
import { LocalApp } from "./LocalApp";
try {
  for (const key of [
    "aftertrace.worklog.session",
    "aftertrace.worklog.returnTo",
  ])
    localStorage.removeItem(key);
} catch {
  /* Storage availability is reported by the local data UI. */
}
if (location.hash.includes("session="))
  history.replaceState({}, "", location.pathname + location.search);
ReactDOM.createRoot(document.getElementById("root")!).render(<LocalApp />);
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        const notify = () => {
          if (reg.waiting && navigator.serviceWorker.controller)
            window.dispatchEvent(
              new CustomEvent("aftertrace:update-ready", {
                detail: reg.waiting,
              }),
            );
        };
        notify();
        reg.addEventListener("updatefound", () =>
          reg.installing?.addEventListener("statechange", notify),
        );
      })
      .catch(() => {});
  });
}
