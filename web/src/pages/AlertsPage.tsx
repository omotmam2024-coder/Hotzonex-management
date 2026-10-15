import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, Button, Card, Checkbox, Field, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { formatJubaTime } from '../lib/format';
import { invokeFunction } from '../lib/functions';
import { supabase } from '../lib/supabase';

interface AlertSettings {
  telegram_connected: boolean;
  telegram_chat_title: string | null;
  notify_offline: boolean;
  notify_push: boolean;
  notify_low_stock: boolean;
  low_stock_threshold: number;
  notify_payments: boolean;
}

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

const KIND_LABEL: Record<string, string> = {
  router_offline: 'Offline',
  router_online: 'Back online',
  push_failed: 'Cards failed',
  push_warning: 'Check cards',
  low_stock: 'Low stock',
  payment_request: 'Payment',
  billing: 'Billing',
  test: 'Test',
};

function TelegramCard({ settings }: { settings: AlertSettings }) {
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
          <p className="text-slate-700">
            Alerts go to <b>{settings.telegram_chat_title ?? 'your Telegram chat'}</b>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending && <Spinner />} Send a test alert
            </Button>
            <Button variant="secondary" onClick={() => connect.mutate()} disabled={connect.isPending}>
              Use another chat
            </Button>
            <Button variant="danger" onClick={() => window.confirm('Stop sending alerts to Telegram?') && unlink.mutate()} disabled={unlink.isPending}>
              Disconnect
            </Button>
          </div>
          {test.isSuccess && <Alert tone="success">Test alert sent. Check Telegram.</Alert>}
        </>
      ) : (
        <>
          <p className="text-slate-700">
            Get alerts on your phone at once: tap Connect, then press <b>Start</b> in Telegram. To alert a group (for example you and your
            managers), add the bot to the group and send it the link's <b>/start</b> message there.
          </p>
          <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending && <Spinner />} Connect Telegram
          </Button>
          {link && (
            <Alert tone="info">
              Telegram did not open?{' '}
              <a href={link.url} target="_blank" rel="noopener" className="font-semibold underline">
                Open @{link.bot}
              </a>{' '}
              and press Start. This page updates by itself once it is connected (the link works for 30 minutes).
            </Alert>
          )}
        </>
      )}
      {error && <Alert tone="error">{friendlyError(error)}</Alert>}
    </Card>
  );
}

function SettingsCard({ settings }: { settings: AlertSettings }) {
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
      return data as AlertSettings;
    },
    onSuccess: (data) => queryClient.setQueryData(['alert-settings'], data),
  });
  const set = <K extends keyof AlertSettings>(k: K, v: AlertSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-bold">What to send</h2>
      <Checkbox label="A router goes offline (after 5 minutes) and comes back" checked={form.notify_offline} onChange={(v) => set('notify_offline', v)} />
      <Checkbox label="New cards failed or need checking on the router" checked={form.notify_push} onChange={(v) => set('notify_push', v)} />
      <Checkbox label="Customers' mobile-money payments to confirm" checked={form.notify_payments} onChange={(v) => set('notify_payments', v)} />
      <Checkbox label="Cards are running low" checked={form.notify_low_stock} onChange={(v) => set('notify_low_stock', v)} />
      {form.notify_low_stock && (
        <div className="max-w-xs">
          <Field label="Low when fewer than" hint="Unsold, unprinted cards of a plan at a site">
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
          {save.isPending && <Spinner />} Save
        </Button>
      </div>
      {save.isSuccess && <Alert tone="success">Saved.</Alert>}
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
    </Card>
  );
}

export function AlertsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const settings = useQuery({
    queryKey: ['alert-settings'],
    enabled: isAdmin,
    queryFn: async (): Promise<AlertSettings> => {
      const { data, error } = await supabase.rpc('get_alert_settings');
      if (error) throw new Error(friendlyError(error));
      return data as AlertSettings;
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
      <PageHeader title="Alerts" subtitle="Routers offline, cards that failed, low stock, payments to confirm" />
      {isAdmin && settings.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <TelegramCard settings={settings.data} />
          <SettingsCard settings={settings.data} />
        </div>
      )}
      {settings.error && <Alert tone="error">{friendlyError(settings.error)}</Alert>}

      <Card>
        <h2 className="mb-3 text-lg font-bold">Needs attention</h2>
        {alerts.isLoading ? (
          <Spinner />
        ) : open.length ? (
          <AlertList rows={open} />
        ) : (
          <p className="text-slate-600">Nothing right now.</p>
        )}
      </Card>
      {history.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">Recent</h2>
          <AlertList rows={history} />
        </Card>
      )}
    </div>
  );
}

function AlertList({ rows }: { rows: AlertRow[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((a) => (
        <li key={a.id} className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={KIND_COLOR[a.kind] ?? 'gray'}>{KIND_LABEL[a.kind] ?? a.kind}</Badge>
            <span className="font-semibold text-slate-900">{a.title}</span>
          </div>
          {a.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{a.body}</p>}
          <p className="mt-1 text-xs text-slate-500">
            {formatJubaTime(a.created_at)}
            {a.sent_at && !a.send_error && ' · sent to Telegram'}
          </p>
        </li>
      ))}
    </ul>
  );
}
