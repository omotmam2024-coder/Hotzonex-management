import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Spinner, TextArea, textButtonClass } from './ui';
import { friendlyError } from '../lib/errors';
import { invokeFunction } from '../lib/functions';

type Lang = 'en' | 'ar' | 'sw';
type Texts = Record<string, Partial<Record<Lang, string>>>;

interface TemplatesReply {
  codes: { code: string; label: string; vars: string[] }[];
  langs: Lang[];
  defaults: Record<string, Record<Lang, string>>;
  custom: Texts;
}

const LANG_LABEL: Record<Lang, string> = { en: 'English', ar: 'العربية — Arabic', sw: 'Kiswahili' };

/** Example words for the preview. */
const SAMPLE: Record<string, string> = {
  business: 'Juba WiFi',
  days: '3',
  date: '31/10/2026',
  price: '15,000 SSP per router per month',
  amount: '120,000 SSP',
  invoice: 'HZC-2026-00012',
  period: '01/10/2026 – 31/10/2026',
  due: '07/11/2026',
  pay: 'MTN MoMo 092 123 4567 (Hotzonex Cloud)',
};

function preview(text: string): string {
  return text.replace(/\{([a-z_]+)\}/g, (all, name: string) => SAMPLE[name] ?? all);
}

/**
 * Platform admins: what businesses are told about their subscription (free trial or paid month
 * ending, invoices, pause, payment received), in English, Arabic and Kiswahili. Each business gets
 * them in the language it chose on its Alerts page. Empty = the default text.
 */
export function BillingMessages() {
  const queryClient = useQueryClient();
  const data = useQuery({
    queryKey: ['billing-templates'],
    queryFn: () => invokeFunction<TemplatesReply>('alerts', { action: 'billing_templates' }),
  });
  const [texts, setTexts] = useState<Texts>({});
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (data.data) setTexts(data.data.custom);
  }, [data.data]);
  const save = useMutation({
    mutationFn: () => invokeFunction<{ custom: Texts }>('alerts', { action: 'billing_templates_save', custom: texts }),
    onSuccess: (d) => {
      setTexts(d.custom);
      void queryClient.invalidateQueries({ queryKey: ['billing-templates'] });
    },
  });

  if (data.isLoading) return <Spinner />;
  if (data.error) return <Alert tone="error">{friendlyError(data.error)}</Alert>;
  const t = data.data!;
  const set = (code: string, lang: Lang, value: string) => setTexts((prev) => ({ ...prev, [code]: { ...prev[code], [lang]: value } }));
  const changed = JSON.stringify(texts) !== JSON.stringify(t.custom);

  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold">Billing messages</h2>
      <p className="text-sm text-slate-600">
        What businesses are told on WhatsApp and Telegram about their Hotzonex Cloud subscription. Each business gets them in the language it chose
        on its Alerts page (English, Arabic or Kiswahili). Leave a text empty to use the default. Messages go to the business&apos;s alert numbers, or
        to the phone it signed up with.
      </p>
      <div className="divide-y divide-slate-100">
        {t.codes.map((c) => {
          const custom = Object.values(texts[c.code] ?? {}).some((v) => v && v.trim());
          const defaults = t.defaults[c.code] ?? { en: '', ar: '', sw: '' };
          return (
            <div key={c.code} className="py-1">
              <button
                type="button"
                aria-expanded={open === c.code}
                onClick={() => setOpen(open === c.code ? null : c.code)}
                className="flex min-h-11 w-full items-center justify-between gap-2 text-left font-semibold text-slate-900"
              >
                <span>{c.label}</span>
                <span className="text-xs font-normal text-slate-500">{custom ? 'Changed' : 'Default'} {open === c.code ? '▲' : '▼'}</span>
              </button>
              {open === c.code && (
                <div className="space-y-3 pb-3">
                  <p className="text-xs text-slate-500">
                    Words you can use: {c.vars.map((v) => `{${v}}`).join(' ')}
                  </p>
                  {t.langs.map((lang) => {
                    const value = texts[c.code]?.[lang] ?? '';
                    const shown = value.trim() || defaults[lang];
                    const bad = [...shown.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1] ?? '').filter((v) => !c.vars.includes(v));
                    return (
                      <div key={lang} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-700">{LANG_LABEL[lang]}</span>
                          {value.trim() && (
                            <button type="button" className={`${textButtonClass} text-brand-700`} onClick={() => set(c.code, lang, '')}>
                              Use default
                            </button>
                          )}
                        </div>
                        <TextArea
                          rows={3}
                          dir={lang === 'ar' ? 'rtl' : 'ltr'}
                          lang={lang}
                          value={value}
                          placeholder={defaults[lang]}
                          onChange={(e) => set(c.code, lang, e.target.value.slice(0, 1000))}
                        />
                        {bad.length > 0 && <p className="text-xs text-red-700">Unknown word: {bad.map((b) => `{${b}}`).join(', ')}</p>}
                        <p dir={lang === 'ar' ? 'rtl' : 'ltr'} className="whitespace-pre-line rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                          {preview(shown)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={!changed || save.isPending}>
          {save.isPending && <Spinner />} Save messages
        </Button>
        {save.isSuccess && !changed && <span className="text-sm text-green-700">Saved.</span>}
      </div>
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
    </Card>
  );
}
