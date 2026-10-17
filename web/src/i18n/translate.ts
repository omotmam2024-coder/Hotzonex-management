import { getLang } from './core';
import { dictionaries, englishToKey, type TKey } from './dictionaries';

export type Vars = Record<string, string | number | null | undefined>;

export function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{([a-zA-Z_]+)\}/g, (all, name: string) => (vars[name] === undefined || vars[name] === null ? all : String(vars[name])));
}

/** A text in the chosen language (English when a translation is missing). Usable outside components. */
export function translate(key: TKey, vars?: Vars): string {
  const lang = getLang();
  return fill(dictionaries[lang][key] ?? dictionaries.en[key] ?? key, vars);
}

/**
 * An English message (from a form check or the server) in the chosen language, when it is one of
 * the known texts; otherwise unchanged. friendlyError() passes every error through this.
 */
export function translateMessage(message: string): string {
  if (getLang() === 'en') return message;
  const key = englishToKey.get(message.trim());
  return key ? translate(key) : message;
}

