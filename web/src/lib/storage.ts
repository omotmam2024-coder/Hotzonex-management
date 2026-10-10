/** Small wrappers so a blocked or full browser storage never breaks the app. */
export function readStored<T>(storage: 'local' | 'session', key: string): T | null {
  try {
    const raw = (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStored(storage: 'local' | 'session', key: string, value: unknown): void {
  try {
    const s = storage === 'local' ? window.localStorage : window.sessionStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch {
    // Only a convenience; ignore.
  }
}
