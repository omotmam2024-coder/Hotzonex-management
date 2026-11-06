// Keeps an open app on the version that is live. The app checks /version.json now and then; once
// there is a newer version it is loaded when the person comes back to the app after a while away
// (never on a tap: on a slow connection a full reload made that page change slow, and never right
// after switching apps: a half-filled form would be lost). Until then the old version keeps working
// (the service worker keeps its files); a screen whose file is gone reloads on its own (lazyPage.ts).

const RELOADED_KEY = 'hzc.reloadedForUpdate';
const CHECK_EVERY_MS = 5 * 60_000;
/** Away from the app at least this long: coming back loads a newer version, if there is one. */
const AWAY_FOR_UPDATE_MS = 30 * 60_000;

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
  let hiddenAt = 0;
  const onVisible = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    void checkForUpdate().then((isNewer) => {
      if (isNewer && away >= AWAY_FOR_UPDATE_MS) reloadForUpdate();
    });
  };
  check();
  const timer = window.setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
