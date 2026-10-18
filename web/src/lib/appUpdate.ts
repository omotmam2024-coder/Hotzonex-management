// Keeps an open app on the version that is live. After a new version is published, the page files
// of the old one are gone from the server, so the app checks /version.json now and then and, once
// there is a newer version, loads it fully on the next page change (the click still lands on the
// page that was chosen).

const RELOADED_KEY = 'hzc.reloadedForUpdate';
const CHECK_EVERY_MS = 5 * 60_000;

let newer = false;

/** Asks the server which version is live (never from a cache). */
export async function checkForUpdate(): Promise<boolean> {
  if (newer) return true;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return false;
    const live = ((await res.json()) as { version?: unknown }).version;
    newer = typeof live === 'string' && live !== __APP_VERSION__;
  } catch {
    // Offline or blocked: try again later.
  }
  return newer;
}

/** A newer version is live and the next page change should load it. */
export function updateReady(): boolean {
  return newer;
}

/**
 * Reloads the page to get the live version, at most once in 15 seconds (so a broken update can
 * never reload in a loop). Returns false when it did not reload.
 */
export function reloadForUpdate(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_KEY) ?? 0);
    if (Date.now() - last < 15_000) return false;
    window.sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    return false; // no storage: the Reload button still works
  }
  window.location.reload();
  return true;
}

/** Checks for a newer version when the app opens, every few minutes and when it is shown again. */
export function watchForUpdates(): () => void {
  if (!import.meta.env.PROD) return () => undefined;
  const check = () => void checkForUpdate();
  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };
  check();
  const timer = window.setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
