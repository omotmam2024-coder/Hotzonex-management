import { translate } from '../i18n/translate';

/**
 * Seconds → short, number-first time in the chosen language, for cards, receipts and the voucher pages:
 * "30 min", "2 hrs", "1 hr 30 min", "1 day", "7 days" (same rules as formatDuration in lib/format).
 */
export function durationText(totalSeconds: number): string {
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
