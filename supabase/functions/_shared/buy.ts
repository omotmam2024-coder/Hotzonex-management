// Checks for what customers type on the Buy page.

export const PROVIDERS = ['mtn_momo', 'mgurush', 'digicash', 'other'] as const;

const LABELS: Record<string, string> = {
  mtn_momo: 'MTN MoMo',
  mgurush: 'm-Gurush',
  digicash: 'Digicash',
  other: 'Other',
};

export function providerLabel(p: string): string {
  return LABELS[p] ?? p;
}

/** "092 123 4567" / "+211-921-234-567" → digits (with a leading +), or null when it is not a phone number. */
export function cleanPhone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/[\s().-]/g, '');
  return /^\+?[0-9]{7,15}$/.test(t) ? t : null;
}

/** A transaction ID as printed in the payment SMS: letters, digits, dots and dashes, upper-cased. */
export function cleanTxnRef(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9.-]{4,40}$/.test(t) ? t : null;
}
