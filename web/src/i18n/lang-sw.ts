// Every Kiswahili text, in one file that is downloaded only when this language is chosen (see dictionaries.ts).
import { common } from './locales/sw/common';
import { messages } from './locales/sw/messages';
import { server } from './locales/sw/server';
import { publicPages } from './locales/sw/publicPages';
import { sell } from './locales/sw/sell';
import { sales } from './locales/sw/sales';
import { vouchers } from './locales/sw/vouchers';
import { reports } from './locales/sw/reports';
import { expenses } from './locales/sw/expenses';
import { plans } from './locales/sw/plans';
import { routers } from './locales/sw/routers';
import { business } from './locales/sw/business';
import { promos } from './locales/sw/promos';
import { insights } from './locales/sw/insights';
import { restock } from './locales/sw/restock';

export const texts: Record<string, string> = Object.assign({}, common, messages, server, publicPages, sell, sales, vouchers, reports, expenses, plans, routers, business, promos, insights, restock);
