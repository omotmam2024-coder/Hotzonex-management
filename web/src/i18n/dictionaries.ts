import type { Lang } from './core';
import { business } from './locales/business';
import { common } from './locales/common';
import { expenses } from './locales/expenses';
import { insights } from './locales/insights';
import { messages } from './locales/messages';
import { plans } from './locales/plans';
import { promos } from './locales/promos';
import { publicPages } from './locales/publicPages';
import { reports } from './locales/reports';
import { restock } from './locales/restock';
import { routers } from './locales/routers';
import { sales } from './locales/sales';
import { sell } from './locales/sell';
import { server } from './locales/server';
import { vouchers } from './locales/vouchers';

// English is built into the app (it is the fallback for any missing text). Arabic and Kiswahili are
// each a separate file, downloaded only by people who choose that language: on a slow connection
// nobody waits for two languages they never read.
const parts = [common, messages, server, publicPages, sell, sales, vouchers, reports, expenses, plans, routers, business, promos, insights, restock] as const;

/** Every text key (from the English dictionaries), so a typo in t('…') fails the type check. */
export type TKey =
  | keyof typeof common.en
  | keyof typeof messages.en
  | keyof typeof server.en
  | keyof typeof publicPages.en
  | keyof typeof sell.en
  | keyof typeof sales.en
  | keyof typeof vouchers.en
  | keyof typeof reports.en
  | keyof typeof expenses.en
  | keyof typeof plans.en
  | keyof typeof routers.en
  | keyof typeof business.en
  | keyof typeof promos.en
  | keyof typeof insights.en
  | keyof typeof restock.en;

type Dict = Partial<Record<TKey, string>>;

const english: Dict = Object.assign({}, ...parts.map((p) => p.en)) as Dict;

/** The texts of each language loaded so far (English always). */
export const dictionaries: Partial<Record<Lang, Dict>> = { en: english };

const loaders: Record<Exclude<Lang, 'en'>, () => Promise<{ texts: Record<string, string> }>> = {
  ar: () => import('./lang-ar'),
  sw: () => import('./lang-sw'),
};
const loading: Partial<Record<Lang, Promise<void>>> = {};

/**
 * Downloads a language's texts once (later calls reuse the same download). If it cannot be loaded
 * (offline on a first visit), the app simply stays in English; a later call tries again.
 */
export function loadLang(lang: Lang): Promise<void> {
  if (lang === 'en' || dictionaries[lang]) return Promise.resolve();
  return (loading[lang] ??= loaders[lang]()
    .then((m) => {
      dictionaries[lang] = m.texts as Dict;
    })
    .catch(() => {
      delete loading[lang];
    }));
}

/** A text in a language: English when that language is not loaded yet or lacks the text. */
export function lookup(lang: Lang, key: TKey): string {
  return dictionaries[lang]?.[key] ?? english[key] ?? key;
}

/** English text → key, to translate messages that arrive in English (form checks, the server). */
export const englishToKey = new Map<string, TKey>();
for (const [key, text] of Object.entries(english) as [TKey, string][]) {
  if (!englishToKey.has(text)) englishToKey.set(text, key);
}
