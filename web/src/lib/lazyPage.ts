import { lazy, type ComponentType } from 'react';
import { checkForUpdate, reloadForUpdate } from './appUpdate';

/** Every screen's loader, so they can all be fetched ahead of time (see preloadPages). */
const loaders: (() => Promise<unknown>)[] = [];

/**
 * A screen loaded on first use. If its file is gone (the app was updated while this page was
 * open), the page reloads to pick up the new version instead of showing an error.
 */
export function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  // One download per screen: the same promise serves the early fetch and the real opening.
  let pending: Promise<Record<K, ComponentType>> | null = null;
  const once = () => {
    pending ??= load().catch((err: unknown) => {
      pending = null; // a failed early fetch is tried again when the screen is really opened
      throw err;
    });
    return pending;
  };
  loaders.push(() => once().catch(() => undefined));
  return lazy(async () => {
    try {
      const mod = await once();
      return { default: mod[name] };
    } catch (err) {
      void checkForUpdate();
      if (reloadForUpdate()) return new Promise<never>(() => undefined);
      throw err;
    }
  });
}

let started = false;

/**
 * Fetches every screen in the background, one at a time while the phone is idle, so tapping a page
 * opens it at once instead of downloading it first. Called once the app has started for a logged-in
 * person; does nothing when the phone asks to save data.
 */
export function preloadPages(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData) return;
  // Older phone browsers (and Safari) have no requestIdleCallback: a short pause instead.
  const ric = (window as { requestIdleCallback?: Window['requestIdleCallback'] }).requestIdleCallback;
  const idle = (fn: () => void) => (ric ? ric.call(window, fn, { timeout: 3000 }) : window.setTimeout(fn, 300));
  let i = 0;
  const next = () => {
    const load = loaders[i++];
    if (load) void load().then(() => idle(next));
  };
  // A few seconds after start: the page that is open now gets the connection first.
  window.setTimeout(() => idle(next), 3000);
}
