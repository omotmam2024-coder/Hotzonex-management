// Every Arabic text, in one file that is downloaded only when this language is chosen (see dictionaries.ts).
import { common } from './locales/ar/common';
import { messages } from './locales/ar/messages';
import { server } from './locales/ar/server';
import { publicPages } from './locales/ar/publicPages';
import { sell } from './locales/ar/sell';
import { sales } from './locales/ar/sales';
import { vouchers } from './locales/ar/vouchers';
import { reports } from './locales/ar/reports';
import { expenses } from './locales/ar/expenses';
import { plans } from './locales/ar/plans';
import { routers } from './locales/ar/routers';
import { business } from './locales/ar/business';
import { promos } from './locales/ar/promos';
import { insights } from './locales/ar/insights';
import { restock } from './locales/ar/restock';

export const texts: Record<string, string> = Object.assign({}, common, messages, server, publicPages, sell, sales, vouchers, reports, expenses, plans, routers, business, promos, insights, restock);
