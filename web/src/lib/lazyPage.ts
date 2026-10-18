import { lazy, type ComponentType } from 'react';
import { checkForUpdate, reloadForUpdate } from './appUpdate';

/**
 * A screen loaded on first use. If its file is gone (the app was updated while this page was
 * open), the page reloads to pick up the new version instead of showing an error.
 */
export function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => {
    try {
      const mod = await load();
      return { default: mod[name] };
    } catch (err) {
      void checkForUpdate();
      if (reloadForUpdate()) return new Promise<never>(() => undefined);
      throw err;
    }
  });
}
