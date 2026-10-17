import type { Lang } from './core';
import { business } from './locales/business';
import { common } from './locales/common';
import { expenses } from './locales/expenses';
import { messages } from './locales/messages';
import { plans } from './locales/plans';
import { publicPages } from './locales/publicPages';
import { reports } from './locales/reports';
import { routers } from './locales/routers';
import { sales } from './locales/sales';
import { sell } from './locales/sell';
import { vouchers } from './locales/vouchers';

const parts = [common, messages, publicPages, sell, sales, vouchers, reports, expenses, plans, routers, business] as const;

/** Every text key (from the English dictionaries), so a typo in t('…') fails the type check. */
export type TKey =
  | keyof typeof common.en
  | keyof typeof messages.en
  | keyof typeof publicPages.en
  | keyof typeof sell.en
  | keyof typeof sales.en
  | keyof typeof vouchers.en
  | keyof typeof reports.en
  | keyof typeof expenses.en
  | keyof typeof plans.en
  | keyof typeof routers.en
  | keyof typeof business.en;

type Dict = Partial<Record<TKey, string>>;

function merge(lang: Lang): Dict {
  const out: Record<string, string> = {};
  for (const p of parts) Object.assign(out, p[lang]);
  return out as Dict;
}

export const dictionaries: Record<Lang, Dict> = { en: merge('en'), ar: merge('ar'), sw: merge('sw') };

/** English text → key, to translate messages that arrive in English (form checks, the server). */
export const englishToKey = new Map<string, TKey>();
for (const [key, text] of Object.entries(dictionaries.en) as [TKey, string][]) {
  if (!englishToKey.has(text)) englishToKey.set(text, key);
}
