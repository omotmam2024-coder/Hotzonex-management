// What a business is told about its Hotzonex Cloud subscription, in English, Arabic or Kiswahili.
//
// The billing run (database) raises "billing" alerts with keys that say what happened:
//   trial_ending:<tenant>:<days>   free trial ends in 7 / 3 / 1 day(s)
//   renew:<invoice>:<days>         the paid month ends in 7 / 3 / 1 day(s)
//   invoice:<invoice>              a new monthly invoice
//   due_soon:<invoice>             the invoice is due in 2 days
//   suspended:<invoice>            unpaid after the due day: the app is paused
//   receipt:<invoice>              the payment was received
// The alerts function turns them into this text in the business's language. The platform admin can
// change any text on Businesses → Billing messages; an empty text means the default below.

export const LANGS = ['en', 'ar', 'sw'] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_NAMES: Record<Lang, string> = { en: 'English', ar: 'العربية (Arabic)', sw: 'Kiswahili' };

export const BILLING_CODES = ['trial_ending', 'renew_soon', 'invoice', 'due_soon', 'suspended', 'paid'] as const;
export type BillingCode = (typeof BILLING_CODES)[number];

/** The words that can be used in each message, e.g. {business}. */
export const BILLING_VARS: Record<BillingCode, string[]> = {
  trial_ending: ['business', 'days', 'date', 'price'],
  renew_soon: ['business', 'days', 'date', 'amount', 'pay'],
  invoice: ['business', 'invoice', 'amount', 'period', 'due', 'pay'],
  due_soon: ['business', 'invoice', 'amount', 'due', 'pay'],
  suspended: ['business', 'invoice', 'amount', 'pay'],
  paid: ['business', 'invoice', 'amount'],
};

export const BILLING_LABELS: Record<BillingCode, string> = {
  trial_ending: 'Free trial ending (7, 3 and 1 day before)',
  renew_soon: 'Paid month ending (7, 3 and 1 day before)',
  invoice: 'New monthly invoice',
  due_soon: 'Invoice due in 2 days',
  suspended: 'App paused (invoice unpaid)',
  paid: 'Payment received',
};

export type Templates = Record<BillingCode, Record<Lang, string>>;

/** "15,000 SSP per router per month" in each language (the {price} word). */
export const PRICE_UNIT: Record<Lang, string> = {
  en: 'per router per month',
  ar: 'لكل راوتر شهرياً',
  sw: 'kwa kila router kwa mwezi',
};

export const DEFAULT_TEMPLATES: Templates = {
  trial_ending: {
    en: '⏳ {business}: your free trial of Hotzonex Cloud ends in {days} day(s), on {date}. After that the service costs {price}. Open the Billing page in the app to keep it running.',
    ar: '⏳ {business}: تنتهي الفترة التجريبية المجانية لـ Hotzonex Cloud بعد {days} يوم، في {date}. بعد ذلك تكلفة الخدمة {price}. افتح صفحة الفواتير في التطبيق لمواصلة الخدمة.',
    sw: '⏳ {business}: kipindi chako cha majaribio bila malipo cha Hotzonex Cloud kinaisha baada ya siku {days}, tarehe {date}. Baada ya hapo huduma inagharimu {price}. Fungua ukurasa wa Malipo (Billing) kwenye programu ili kuendelea.',
  },
  renew_soon: {
    en: '⏳ {business}: your Hotzonex Cloud service is paid until {date} ({days} day(s) left). Next month: {amount}. Pay early so the app is not paused.\n{pay}',
    ar: '⏳ {business}: خدمة Hotzonex Cloud مدفوعة حتى {date} (متبقٍ {days} يوم). الشهر القادم: {amount}. ادفع مبكراً حتى لا يتوقف التطبيق.\n{pay}',
    sw: '⏳ {business}: huduma yako ya Hotzonex Cloud imelipiwa hadi {date} (zimebaki siku {days}). Mwezi ujao: {amount}. Lipa mapema ili programu isisimamishwe.\n{pay}',
  },
  invoice: {
    en: '🧾 {business}: Hotzonex Cloud invoice {invoice} for {period}: {amount}. Please pay by {due}.\n{pay}',
    ar: '🧾 {business}: فاتورة Hotzonex Cloud رقم {invoice} للفترة {period}: {amount}. يرجى الدفع قبل {due}.\n{pay}',
    sw: '🧾 {business}: ankara ya Hotzonex Cloud {invoice} ya kipindi {period}: {amount}. Tafadhali lipa kabla ya {due}.\n{pay}',
  },
  due_soon: {
    en: '⚠️ {business}: Hotzonex Cloud invoice {invoice} ({amount}) is due on {due}. After that the app is paused (your WiFi keeps working).\n{pay}',
    ar: '⚠️ {business}: فاتورة Hotzonex Cloud رقم {invoice} ({amount}) مستحقة في {due}. بعد ذلك يتوقف التطبيق (شبكة الواي فاي تستمر في العمل).\n{pay}',
    sw: '⚠️ {business}: ankara ya Hotzonex Cloud {invoice} ({amount}) inapaswa kulipwa tarehe {due}. Baada ya hapo programu itasimamishwa (WiFi yako itaendelea kufanya kazi).\n{pay}',
  },
  suspended: {
    en: '⛔ {business}: Hotzonex Cloud is paused because invoice {invoice} ({amount}) is unpaid. Your WiFi keeps working. Pay, then log in and send the transaction ID to open the app again.\n{pay}',
    ar: '⛔ {business}: تم إيقاف Hotzonex Cloud لأن الفاتورة {invoice} ({amount}) غير مدفوعة. شبكة الواي فاي تستمر في العمل. ادفع، ثم سجّل الدخول وأرسل رقم العملية لإعادة فتح التطبيق.\n{pay}',
    sw: '⛔ {business}: Hotzonex Cloud imesimamishwa kwa sababu ankara {invoice} ({amount}) haijalipwa. WiFi yako inaendelea kufanya kazi. Lipa, kisha ingia na utume namba ya muamala ili kufungua programu tena.\n{pay}',
  },
  paid: {
    en: '✅ {business}: thank you! Hotzonex Cloud invoice {invoice} ({amount}) is paid. Your service continues.',
    ar: '✅ {business}: شكراً لك! تم دفع فاتورة Hotzonex Cloud رقم {invoice} ({amount}). تستمر خدمتك.',
    sw: '✅ {business}: asante! Ankara ya Hotzonex Cloud {invoice} ({amount}) imelipwa. Huduma yako inaendelea.',
  },
};

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/** Which message an alert key is ("invoice:…" → invoice, "receipt:…" → paid, "renew:…" → renew_soon). */
export function billingCode(key: string): BillingCode | null {
  const prefix = key.split(':')[0];
  switch (prefix) {
    case 'trial_ending':
      return 'trial_ending';
    case 'renew':
      return 'renew_soon';
    case 'invoice':
      return 'invoice';
    case 'due_soon':
      return 'due_soon';
    case 'suspended':
      return 'suspended';
    case 'receipt':
      return 'paid';
    default:
      return null;
  }
}

/** The invoice id in "invoice:<id>", "renew:<id>:<days>" etc. (null for trial alerts). */
export function billingInvoiceId(key: string): string | null {
  const [prefix, id] = key.split(':');
  return prefix !== 'trial_ending' && id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** The days left in "trial_ending:<tenant>:<days>" / "renew:<invoice>:<days>". */
export function billingDays(key: string): number | null {
  const d = Number(key.split(':')[2]);
  return Number.isInteger(d) && d > 0 ? d : null;
}

/** Saved custom texts, keeping only known messages and languages (empty = default). */
export function cleanTemplates(input: unknown): Partial<Templates> {
  const out: Partial<Templates> = {};
  if (!input || typeof input !== 'object') return out;
  for (const code of BILLING_CODES) {
    const row = (input as Record<string, unknown>)[code];
    if (!row || typeof row !== 'object') continue;
    for (const lang of LANGS) {
      const t = (row as Record<string, unknown>)[lang];
      if (typeof t === 'string' && t.trim()) {
        (out[code] ??= {} as Record<Lang, string>)[lang] = t.trim().slice(0, 1000);
      }
    }
  }
  return out;
}

/** Words in braces that the message does not know (shown as a mistake before saving). */
export function unknownVars(code: BillingCode, text: string): string[] {
  const known = new Set(BILLING_VARS[code]);
  return [...new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((v) => !known.has(v)))];
}

/** The message in the business's language: custom text if set, otherwise the default; words filled in. */
export function renderBilling(code: BillingCode, lang: Lang, vars: Record<string, string | number | null | undefined>, custom: Partial<Templates> = {}): string {
  const template = custom[code]?.[lang] || DEFAULT_TEMPLATES[code][lang];
  return template
    .replace(/\{([a-z_]+)\}/g, (all, name: string) => {
      const v = vars[name];
      return v === undefined || v === null ? (BILLING_VARS[code].includes(name) ? '' : all) : String(v);
    })
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l, i, lines) => l !== '' || (i > 0 && i < lines.length - 1))
    .join('\n')
    .trim()
    .slice(0, 4000);
}

/** 2026-10-31 (or a timestamp) → "31/10/2026": the same in every language. */
export function billingDate(value: string | null | undefined, timeZone = 'Africa/Juba'): string {
  if (!value) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function ssp(n: number | null | undefined): string {
  return `${new Intl.NumberFormat('en-US').format(n ?? 0)} SSP`;
}
