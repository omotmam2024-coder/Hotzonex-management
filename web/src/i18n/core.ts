/** The three languages of Hotzonex Cloud. Arabic is written right to left. */
export type Lang = 'en' | 'ar' | 'sw';

export const LANGUAGES: { key: Lang; label: string; short: string }[] = [
  { key: 'en', label: 'English', short: 'EN' },
  { key: 'ar', label: 'العربية', short: 'ع' },
  { key: 'sw', label: 'Kiswahili', short: 'SW' },
];

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ar' || v === 'sw';

/** Locale for dates and month names (Latin digits in every language, like prices). */
export const LOCALE: Record<Lang, string> = { en: 'en-GB', ar: 'ar-u-nu-latn', sw: 'sw' };

const KEY = 'hzc-lang';

function firstLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return nav.startsWith('ar') ? 'ar' : nav.startsWith('sw') ? 'sw' : 'en';
}

let current: Lang = firstLang();
const listeners = new Set<(l: Lang) => void>();

/** The language chosen on this device (the menu or the login page). */
export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage blocked: the choice lasts until the page is reloaded */
  }
  applyLang();
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** <html lang="ar" dir="rtl"> so the browser lays Arabic pages out right to left. */
export function applyLang(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
}
