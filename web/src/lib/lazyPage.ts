import { lazy, type ComponentType } from 'react';

const RELOADED = 'hzc.reloadedForUpdate';

function flag(set?: boolean): boolean {
  try {
    if (set === true) sessionStorage.setItem(RELOADED, '1');
    if (set === false) sessionStorage.removeItem(RELOADED);
    return sessionStorage.getItem(RELOADED) === '1';
  } catch {
    return true; // no storage: never reload, so it cannot loop
  }
}

/**
 * A screen loaded on first use. If its file is gone (the app was updated while this page was
 * open), the page reloads once to pick up the new version instead of showing an error.
 */
export function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => {
    try {
      const mod = await load();
      flag(false);
      return { default: mod[name] };
    } catch (err) {
      if (!flag()) {
        flag(true);
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw err;
    }
  });
}
