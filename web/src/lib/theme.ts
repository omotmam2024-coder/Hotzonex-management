/** Light / Dark / Auto (follows the phone or computer). Saved on this device only. */
export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'hzc-theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Puts the `dark` class on <html> for the saved choice. Print pages always stay light. */
export function applyTheme(pathname = window.location.pathname): void {
  const pref = getThemePref();
  const dark = !pathname.startsWith('/print') && (pref === 'dark' || (pref === 'system' && systemDark()));
  document.documentElement.classList.toggle('dark', dark);
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage blocked: the choice lasts until the page is reloaded */
  }
  applyTheme();
}

/** Keeps "Auto" in step when the phone switches between light and dark. */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyTheme();
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
