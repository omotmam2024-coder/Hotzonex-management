import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Checkbox, Field, Select, Spinner, TextArea, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatJubaTime } from '../../lib/format';
import { invokeFunction } from '../../lib/functions';
import { fromJson, supabase } from '../../lib/supabase';
import { formatWhatsAppNumber, type WhatsAppStatus } from '../../lib/whatsapp';
import { translate, useT, type TKey } from '../../i18n';

interface AlertSettings {
  telegram_connected: boolean;
  telegram_chat_title: string | null;
  notify_offline: boolean;
  notify_push: boolean;
  notify_low_stock: boolean;
  low_stock_threshold: number;
  notify_payments: boolean;
  whatsapp_numbers: string[];
  lang: 'en' | 'ar' | 'sw';
}

const LANGUAGES: { key: AlertSettings['lang']; label: string }[] = [
  { key: 'en', label: 'English' },
  {
    key: 'ar',
    get label() {
      return translate('reports.alerts.langArabic');
    },
  },
  { key: 'sw', label: 'Kiswahili' },
];

interface AlertRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
  sent_at: string | null;
  send_error: string | null;
}

const KIND_COLOR: Record<string, 'red' | 'green' | 'gray' | 'blue'> = {
  router_offline: 'red',
  push_failed: 'red',
  router_online: 'green',
  push_warning: 'gray',
  low_stock: 'gray',
  payment_request: 'blue',
  billing: 'blue',
};

const KINDS = ['router_offline', 'router_online', 'push_failed', 'push_warning', 'low_stock', 'payment_request', 'billing', 'test'];
/** The badge text of an alert kind in the chosen language; unknown kinds show as they are. */
const kindLabel = (kind: string) => (KINDS.includes(kind) ? translate(`reports.alerts.kind.${kind}` as TKey) : kind);

/** Puts React nodes where a translated text has {name} placeholders (for bold words inside a sentence). */
function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{[a-zA-Z_]+\})/).map((piece, i) => {
    const name = /^\{([a-zA-Z_]+)\}$/.exec(piece)?.[1];
    return <Fragment key={i}>{name && name in parts ? parts[name] : piece}</Fragment>;
  });
}

function TelegramCard({ settings }: { settings: AlertSettings }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [link, setLink] = useState<{ url: string; bot: string } | null>(null);

  const connect = useMutation({
    mutationFn: () => invokeFunction<{ url: string; bot: string }>('alerts', { action: 'link' }),
    onSuccess: (r) => {
      setLink(r);
      window.open(r.url, '_blank', 'noopener');
    },
  });
  const test = useMutation({ mutationFn: () => invokeFunction('alerts', { action: 'test' }) });
  const unlink = useMutation({
    mutationFn: () => invokeFunction('alerts', { action: 'unlink' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alert-settings'] }),
  });

  // While the person connects in Telegram, check every few seconds.
  useEffect(() => {
    if (!link || settings.telegram_connected) return;
    const t = window.setInterval(() => void queryClient.invalidateQueries({ queryKey: ['alert-settings'] }), 4000);
    return () => window.clearInterval(t);
  }, [link, settings.telegram_connected, queryClient]);

  const error = connect.error ?? test.error ?? unlink.error;
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold">Telegram</h2>
      {settings.telegram_connected ? (
        <>
          <p className="text-slate-700">{rich(t('reports.alerts.tgGoesTo'), { chat: <b>{settings.telegram_chat_title ?? t('reports.alerts.tgYourChat')}</b> })}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending && <Spinner />} {t('reports.alerts.tgSendTest')}
            </Button>
            <Button variant="secondary" onClick={() => connect.mutate()} disabled={connect.isPending}>
              {t('reports.alerts.tgUseAnother')}
            </Button>
            <Button variant="danger" onClick={() => window.confirm(t('reports.alerts.tgConfirmStop')) && unlink.mutate()} disabled={unlink.isPending}>
              {t('reports.alerts.tgDisconnect')}
            </Button>
          </div>
          {test.isSuccess && <Alert tone="success">{t('reports.alerts.tgTestSent')}</Alert>}
        </>
      ) : (
        <>
          <p className="text-slate-700">{rich(t('reports.alerts.tgIntro'), { start: <b>{t('reports.alerts.tgStartBtn')}</b>, cmd: <b>/start</b> })}</p>
          <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending && <Spinner />} {t('reports.alerts.tgConnect')}
          </Button>
          {link && (
            <Alert tone="info">
              {t('reports.alerts.tgNotOpen')}{' '}
              <a href={link.url} target="_blank" rel="noopener" className="font-semibold underline">
                {t('reports.alerts.tgOpenBot', { bot: link.bot })}
              </a>{' '}
              {t('reports.alerts.tgNotOpenAfter')}
            </Alert>
          )}
        </>
      )}
      {error && <Alert tone="error">{friendlyError(error)}</Alert>}
    </Card>
  );
}

function WhatsAppCard({ settings }: { settings: AlertSettings }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const saved = settings.whatsapp_numbers.map(formatWhatsAppNumber).join('\n');
  const [text, setText] = useState(saved);
  const status = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => invokeFunction<WhatsAppStatus>('alerts', { action: 'whatsapp_status' }),
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: async () => {
      const list = text.split(/[\n,;]+/).map((n) => n.trim()).filter(Boolean);
      if (list.length > 5) throw new Error(t('msg.upTo5'));
      const { data, error } = await supabase.rpc('save_alert_whatsapp', { p_numbers: list });
      if (error) throw new Error(friendlyError(error));
      return fromJson<AlertSettings>(data);
    },
    onSuccess: (d) => {
      queryClient.setQueryData(['alert-settings'], d);
      setText(d.whatsapp_numbers.map(formatWhatsAppNumber).join('\n'));
    },
  });
  const test = useMutation({ mutationFn: () => invokeFunction<{ sent: string[]; failed: string[] }>('alerts', { action: 'whatsapp_test' }) });
  const language = useMutation({
    mutationFn: async (lang: AlertSettings['lang']) => {
      const { data, error } = await supabase.rpc('save_alert_language', { p_lang: lang });
      if (error) throw new Error(friendlyError(error));
      return fromJson<AlertSettings>(data);
    },
    onSuccess: (d) => queryClient.setQueryData(['alert-settings'], d),
  });

  const s = status.data;
  const hasNumbers = settings.whatsapp_numbers.length > 0;
  const error = save.error ?? test.error ?? language.error;
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold">WhatsApp</h2>
      <p className="text-slate-700">
        {s?.connected && s.sender
          ? rich(t('reports.alerts.waIntroFrom'), {
              sender: (
                <b dir="ltr" className="inline-block">
                  {s.sender}
                </b>
              ),
            })
          : t('reports.alerts.waIntroPlain')}
      </p>
      {s && !s.connected && (
        <Alert tone="info">
          {s.installed
            ? t('reports.alerts.waOffline')
            : t('reports.alerts.waSetup')}
        </Alert>
      )}
      <Field label={t('reports.alerts.waNumbers')} hint={t('reports.alerts.waNumbersHint')}>
        <TextArea rows={3} inputMode="tel" dir="ltr" value={text} onChange={(e) => setText(e.target.value.slice(0, 200))} placeholder="0924904216" />
      </Field>
      <Field label={t('reports.alerts.msgLang')} hint={t('reports.alerts.msgLangHint')}>
        <Select value={settings.lang} onChange={(e) => language.mutate(e.target.value as AlertSettings['lang'])} disabled={language.isPending}>
          {LANGUAGES.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending || text.trim() === saved.trim()}>
          {save.isPending && <Spinner />} {t('reports.alerts.saveNumbers')}
        </Button>
        <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || !hasNumbers || !s?.connected}>
          {test.isPending && <Spinner />} {t('reports.alerts.sendTestMsg')}
        </Button>
      </div>
      {save.isSuccess && <Alert tone="success">{t('reports.alerts.saved')}</Alert>}
      {test.data && (
        <Alert tone={test.data.failed.length ? 'warning' : 'success'}>
          {test.data.sent.length > 0 && <>{t('reports.alerts.testSentTo', { list: test.data.sent.join(', ') })}</>}
          {test.data.failed.length > 0 && <>{t('reports.alerts.notSent', { list: test.data.failed.join('; ') })}</>}
        </Alert>
      )}
      {error && <Alert tone="error">{friendlyError(error)}</Alert>}
    </Card>
  );
}

function SettingsCard({ settings }: { settings: AlertSettings }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('save_alert_settings', {
        p_notify_offline: form.notify_offline,
        p_notify_push: form.notify_push,
        p_notify_low_stock: form.notify_low_stock,
        p_low_stock_threshold: Number(form.low_stock_threshold),
        p_notify_payments: form.notify_payments,
      });
      if (error) throw new Error(friendlyError(error));
      return fromJson<AlertSettings>(data);
    },
    onSuccess: (data) => queryClient.setQueryData(['alert-settings'], data),
  });
  const set = <K extends keyof AlertSettings>(k: K, v: AlertSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-bold">{t('reports.alerts.whatToSend')}</h2>
      <Checkbox label={t('reports.alerts.cbOffline')} checked={form.notify_offline} onChange={(v) => set('notify_offline', v)} />
      <Checkbox label={t('reports.alerts.cbPush')} checked={form.notify_push} onChange={(v) => set('notify_push', v)} />
      <Checkbox label={t('reports.alerts.cbPayments')} checked={form.notify_payments} onChange={(v) => set('notify_payments', v)} />
      <Checkbox label={t('reports.alerts.cbLow')} checked={form.notify_low_stock} onChange={(v) => set('notify_low_stock', v)} />
      {form.notify_low_stock && (
        <div className="max-w-xs">
          <Field label={t('reports.alerts.lowWhen')} hint={t('reports.alerts.lowHint')}>
            <TextInput
              inputMode="numeric"
              value={String(form.low_stock_threshold)}
              onChange={(e) => set('low_stock_threshold', Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0)}
            />
          </Field>
        </div>
      )}
      <div className="pt-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Spinner />} {t('common.save')}
        </Button>
      </div>
      {save.isSuccess && <Alert tone="success">{t('reports.alerts.saved')}</Alert>}
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
    </Card>
  );
}

export function AlertsPage() {
  const { profile } = useAuth();
  const { t } = useT();
  const isAdmin = profile?.role === 'admin';

  const settings = useQuery({
    queryKey: ['alert-settings'],
    enabled: isAdmin,
    queryFn: async (): Promise<AlertSettings> => {
      const { data, error } = await supabase.rpc('get_alert_settings');
      if (error) throw new Error(friendlyError(error));
      return fromJson<AlertSettings>(data);
    },
  });

  const alerts = useQuery({
    queryKey: ['alerts'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<AlertRow[]> => {
      const { data, error } = await supabase
        .from('alerts')
        .select('id, kind, title, body, created_at, resolved_at, sent_at, send_error')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(friendlyError(error));
      return (data ?? []) as AlertRow[];
    },
  });

  const open = (alerts.data ?? []).filter((a) => !a.resolved_at);
  const history = (alerts.data ?? []).filter((a) => a.resolved_at);

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.alerts')} subtitle={t('reports.alerts.subtitle')} />
      {isAdmin && settings.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <WhatsAppCard settings={settings.data} />
          <TelegramCard settings={settings.data} />
          <SettingsCard settings={settings.data} />
        </div>
      )}
      {settings.error && <Alert tone="error">{friendlyError(settings.error)}</Alert>}

      <Card>
        <h2 className="mb-3 text-lg font-bold">{t('reports.alerts.needsAttention')}</h2>
        {alerts.isLoading ? (
          <Spinner />
        ) : open.length ? (
          <AlertList rows={open} />
        ) : (
          <p className="text-slate-600">{t('reports.alerts.nothingNow')}</p>
        )}
      </Card>
      {history.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">{t('reports.alerts.recent')}</h2>
          <AlertList rows={history} />
        </Card>
      )}
    </div>
  );
}

function AlertList({ rows }: { rows: AlertRow[] }) {
  const { t } = useT();
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((a) => (
        <li key={a.id} className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={KIND_COLOR[a.kind] ?? 'gray'}>{kindLabel(a.kind)}</Badge>
            <span className="font-semibold text-slate-900">{a.title}</span>
          </div>
          {a.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{a.body}</p>}
          <p className="mt-1 text-xs text-slate-500">
            {formatJubaTime(a.created_at)}
            {a.sent_at && !a.send_error && t('reports.alerts.sentTelegram')}
          </p>
        </li>
      ))}
    </ul>
  );
}
