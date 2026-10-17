import { getLang, LOCALE } from '../i18n/core';
import { translate } from '../i18n/translate';

const TZ = 'Africa/Juba';

/** Date formats in the chosen language (Latin digits), made once per language. */
const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(name: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const lang = getLang();
  const key = `${lang}:${name}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: TZ, ...opts });
    cache.set(key, f);
  }
  return f;
}
const timeFmt = () => fmt('time', { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = () => fmt('dateTime', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "9 Oct 2026" (Juba time). Accepts a timestamp or a YYYY-MM-DD day. */
export function formatJubaDate(value: string | null | undefined): string {
  if (!value) return '—';
  return fmt('longDate', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value));
}

/** "9 Oct 2026, 14:20" (Juba time), e.g. "Generated …" on printed reports and receipts. */
export function formatJubaStamp(date: Date = new Date()): string {
  return fmt('stamp', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

/** "14:20" if the moment is today in Juba, otherwise "9 Oct, 14:20". */
export function formatJubaTime(iso: string | null | undefined): string {
  if (!iso) return translate('common.never');
  const d = new Date(iso);
  return dayFmt.format(d) === dayFmt.format(new Date()) ? timeFmt().format(d) : dateTimeFmt().format(d);
}

/** "just now", "5 min ago", "3 h ago", or a date. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return translate('common.never');
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return translate('common.justNow');
  if (seconds < 3600) return translate('common.minAgo', { n: Math.round(seconds / 60) });
  if (seconds < 86400) return translate('common.hAgo', { n: Math.round(seconds / 3600) });
  return formatJubaTime(iso);
}

/** Strips a "/32" suffix Postgres may add to inet values. */
export function bareIp(ip: string): string {
  return ip.split('/')[0] ?? ip;
}

const numberFmt = new Intl.NumberFormat('en-US');

/** 1000 → "1,000 SSP" */
export function formatSSP(amount: number): string {
  return `${numberFmt.format(amount)} SSP`;
}

/** An SSP amount in USD at the business's rate ("≈ $1.25"), or '' when no rate is set. */
export function formatUsd(amountSsp: number, usdRate: number | null | undefined): string {
  if (!usdRate || !(usdRate > 0)) return '';
  const usd = amountSsp / usdRate;
  return `≈ ${usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(n: number): string {
  return numberFmt.format(n);
}

/** Seconds → short, number-first text for staff and cards: "30 min", "2 hrs", "1 hr 30 min", "1 day", "7 days". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return translate('vouchers.dur.min', { n: 0 });
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(translate(days === 1 ? 'vouchers.dur.day' : 'vouchers.dur.days', { n: days }));
  if (hours) parts.push(translate(hours === 1 ? 'vouchers.dur.hr' : 'vouchers.dur.hrs', { n: hours }));
  if (minutes && !days) parts.push(translate('vouchers.dur.min', { n: minutes }));
  if (parts.length === 0) return translate('vouchers.dur.sec', { n: totalSeconds });
  return parts.join(' ');
}

/** Today's date in Juba as YYYY-MM-DD (for date inputs and report periods). */
export function jubaToday(): string {
  return dayFmt.format(new Date());
}

/** "48213570" → ["4821", "3570"]: groups of 4 for reading a code aloud. */
export function codeGroups(code: string): string[] {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += 4) groups.push(code.slice(i, i + 4));
  return groups;
}

/** 1536000 → "1.5 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
