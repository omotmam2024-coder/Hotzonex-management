import { useSearchParams } from 'react-router-dom';
import { getLang, LOCALE } from '../i18n/core';
import { translate } from '../i18n/translate';
import { jubaToday } from './format';

/** Day / week (Monday–Sunday) / calendar-month periods, as the report functions in the database use them. */
export type Period = 'day' | 'week' | 'month';

export const PERIODS: { key: Period; label: string; noun: string }[] = [
  {
    key: 'day',
    get label() {
      return translate('period.daily');
    },
    get noun() {
      return translate('period.daily');
    },
  },
  {
    key: 'week',
    get label() {
      return translate('period.weekly');
    },
    get noun() {
      return translate('period.weekly');
    },
  },
  {
    key: 'month',
    get label() {
      return translate('period.monthly');
    },
    get noun() {
      return translate('period.monthly');
    },
  },
];

export const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Day names in the chosen language (the day itself is a plain date, so UTC). */
const cache = new Map<string, Intl.DateTimeFormat>();
const fmt = (name: string, opts: Intl.DateTimeFormatOptions) => {
  const key = `${getLang()}:${name}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE[getLang()], { ...opts, timeZone: 'UTC' });
    cache.set(key, f);
  }
  return f;
};
const longDay = { format: (d: Date) => fmt('long', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d) };
export const shortDay = { format: (d: Date) => fmt('short', { weekday: 'short', day: 'numeric', month: 'short' }).format(d) };
const monthYear = { format: (d: Date) => fmt('month', { month: 'long', year: 'numeric' }).format(d) };

export function parsePeriod(value: string | null): Period {
  return value === 'week' || value === 'month' ? value : 'day';
}

/** Moves a date by whole periods (days, weeks or calendar months). */
export function shiftPeriod(date: string, period: Period, steps: number): string {
  const d = utc(date);
  if (period === 'day') d.setUTCDate(d.getUTCDate() + steps);
  else if (period === 'week') d.setUTCDate(d.getUTCDate() + 7 * steps);
  else {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + steps);
  }
  return iso(d);
}

/** First day of the period that contains `date` (Monday for weeks). */
export function periodStart(date: string, period: Period): string {
  const d = utc(date);
  if (period === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  else if (period === 'month') d.setUTCDate(1);
  return iso(d);
}

export function periodLabel(period: Period, start: string, end: string): string {
  if (period === 'day') return longDay.format(utc(start));
  if (period === 'week') return `${shortDay.format(utc(start))} – ${shortDay.format(utc(end))} ${utc(end).getUTCFullYear()}`;
  return monthYear.format(utc(start));
}

/** "Today" / "This week" / "This month". */
export function currentPeriodName(period: Period): string {
  return translate(period === 'day' ? 'period.today' : period === 'week' ? 'period.thisWeek' : 'period.thisMonth');
}

/** Period, day and site kept in the address (?tab=week&date=…&site=…), so a report can be shared or reloaded. */
export function usePeriodParams(canChooseSite: boolean) {
  const [params, setParams] = useSearchParams();
  const tab = parsePeriod(params.get('tab'));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? (params.get('date') as string) : jubaToday();
  const siteId = canChooseSite ? (params.get('site') ?? '') : '';
  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  return { params, tab, date, siteId, set };
}
