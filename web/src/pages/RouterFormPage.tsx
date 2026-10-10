import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { Alert, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { bareIp } from '../lib/format';
import { invokeFunction } from '../lib/functions';
import { AgentTimeoutError, waitForJob } from '../lib/jobs';
import { useSites } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { ROUTER_COLUMNS, type RouterInfo, type TestConnectionResult } from '../lib/types';

interface FormState {
  name: string;
  site_id: string;
  ip_address: string;
  port: string;
  use_https: boolean;
  username: string;
  password: string;
  hotspot_server: string;
  dns_name: string;
}

const EMPTY: FormState = {
  name: '',
  site_id: '',
  ip_address: '',
  port: '80',
  use_https: false,
  username: 'hzc-api',
  password: '',
  hotspot_server: 'hotspot1',
  dns_name: '',
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'testing'; ip: string }
  | { kind: 'success'; result: TestConnectionResult }
  | { kind: 'failed'; message: string };

const PRIVATE_IP_RE = /^(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}$/;

function RouterPrepHelp() {
  return (
    <Card className="bg-slate-50">
      <h2 className="font-bold text-slate-900">Prepare the router first</h2>
      <p className="mt-1 text-sm text-slate-600">
        Open the router terminal (Winbox → New Terminal) and run these commands. Replace{' '}
        <code className="rounded bg-white px-1">&lt;agent-PC-IP&gt;</code> with the local IP of the computer running the Router Agent.
      </p>
      <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
        {`/ip service set www disabled=no port=80 address=<agent-PC-IP>/32
/user group add name=hzc-api policy=read,write,api,rest-api,test
/user add name=hzc-api group=hzc-api password=<strong-password>`}
      </pre>
    </Card>
  );
}

export function RouterFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sites = useSites();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [formError, setFormError] = useState<string | null>(null);

  const existing = useQuery({
    queryKey: ['router', id],
    enabled: isEdit,
    queryFn: async (): Promise<RouterInfo | null> => {
      const { data, error } = await supabase.from('routers').select(ROUTER_COLUMNS).eq('id', id ?? '').maybeSingle();
      if (error) throw new Error(error.message);
      return data as RouterInfo | null;
    },
  });

  useEffect(() => {
    const r = existing.data;
    if (r) {
      setForm({
        name: r.name,
        site_id: r.site_id,
        ip_address: bareIp(r.ip_address),
        port: String(r.port),
        use_https: r.use_https,
        username: r.username,
        password: '',
        hotspot_server: r.hotspot_server,
        dns_name: r.dns_name,
      });
    }
  }, [existing.data]);

  // Pick the only site automatically on a new router.
  useEffect(() => {
    const only = sites.data?.length === 1 ? sites.data[0] : undefined;
    if (!isEdit && !form.site_id && only) setForm((f) => ({ ...f, site_id: only.id }));
  }, [isEdit, form.site_id, sites.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  function validate(): string | null {
    if (!form.name.trim()) return 'Router name is required.';
    if (!form.site_id) return 'Choose a site.';
    if (!PRIVATE_IP_RE.test(form.ip_address.trim())) return 'Enter the router’s private LAN IP, e.g. 192.168.88.1.';
    const port = Number(form.port || '80');
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port must be a number from 1 to 65535.';
    if (!form.username.trim()) return 'Router username is required.';
    if (!isEdit && !form.password) return 'Router password is required.';
    if (!form.hotspot_server.trim()) return 'Hotspot server name is required.';
    if (!form.dns_name.trim()) return 'DNS name is required.';
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    setFormError(problem);
    if (problem) return;

    setPhase({ kind: 'saving' });
    try {
      const { job_id } = await invokeFunction<{ router_id: string; job_id: string }>('add-router', {
        action: isEdit ? 'update' : 'create',
        router_id: id,
        name: form.name.trim(),
        site_id: form.site_id,
        ip_address: form.ip_address.trim(),
        port: Number(form.port || '80'),
        use_https: form.use_https,
        username: form.username.trim(),
        password: form.password,
        hotspot_server: form.hotspot_server.trim(),
        dns_name: form.dns_name.trim(),
      });
      setPhase({ kind: 'testing', ip: form.ip_address.trim() });
      const job = await waitForJob(job_id);
      const result = (job.result ?? {}) as TestConnectionResult;
      if (job.status === 'done') {
        setForm((f) => ({ ...f, password: '' }));
        setPhase({ kind: 'success', result });
      } else {
        const tail = isEdit ? ' The changes were saved, but the router is marked offline until the test passes.' : ' Nothing was saved.';
        setPhase({ kind: 'failed', message: (result.error ?? 'The connection test failed.') + tail });
      }
    } catch (err) {
      if (err instanceof AgentTimeoutError) {
        const why = 'The router did not answer within 60 seconds.';
        setPhase({
          kind: 'failed',
          message:
            why +
            (isEdit
              ? ' Your changes are saved; the test will run again automatically.'
              : ' The router is kept and tested again automatically — no need to add it again.'),
        });
      } else {
        setPhase({ kind: 'failed', message: friendlyError(err) });
      }
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['routers'] });
      if (id) void queryClient.invalidateQueries({ queryKey: ['router', id] });
    }
  }

  if (isEdit && existing.isLoading) return <Spinner className="h-8 w-8 text-brand-600" />;
  if (isEdit && !existing.isLoading && !existing.data)
    return <Alert tone="error">This router no longer exists.</Alert>;

  const busy = phase.kind === 'saving' || phase.kind === 'testing';

  if (phase.kind === 'success') {
    const r = phase.result;
    return (
      <div className="max-w-2xl space-y-4">
        <PageHeader title={isEdit ? 'Router updated' : 'Router added'} />
        <Card>
          <Alert tone="success">
            <strong>{form.name}</strong> is online.
          </Alert>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Model</dt>
              <dd className="font-semibold">{r.model ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">RouterOS</dt>
              <dd className="font-semibold">{r.ros_version ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Uptime</dt>
              <dd className="font-semibold">{r.uptime ?? '—'}</dd>
            </div>
          </dl>
          {(r.warnings ?? []).map((w) => (
            <div key={w} className="mt-3">
              <Alert tone="warning">{w}</Alert>
            </div>
          ))}
          <div className="mt-5">
            <Button onClick={() => navigate('/routers')}>Back to routers</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={isEdit ? 'Edit router' : 'Add router'}
        subtitle="The router is saved only after the Router Agent logs in to it successfully."
      />
      <RouterPrepHelp />

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Router name">
              <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Jebel Iraq Main" maxLength={60} disabled={busy} />
            </Field>
            <Field label="Site">
              <Select value={form.site_id} onChange={(e) => set('site_id', e.target.value)} disabled={busy}>
                <option value="">Choose a site…</option>
                {(sites.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Private IP address" hint="The router's LAN address, e.g. 192.168.88.1">
              <TextInput
                value={form.ip_address}
                onChange={(e) => set('ip_address', e.target.value)}
                placeholder="192.168.88.1"
                inputMode="decimal"
                disabled={busy}
              />
            </Field>
            <Field label="Port" hint="REST port of the www service (80 by default)">
              <TextInput value={form.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} inputMode="numeric" disabled={busy} />
            </Field>
            <Field label="Router username">
              <TextInput value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" disabled={busy} />
            </Field>
            <Field label="Router password" hint={isEdit ? 'Leave blank to keep the current password' : undefined}>
              <TextInput
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                autoComplete="new-password"
                placeholder={isEdit ? '••••••••' : ''}
                disabled={busy}
              />
            </Field>
            <Field label="Hotspot server name" hint="Vouchers will only work on this hotspot">
              <TextInput value={form.hotspot_server} onChange={(e) => set('hotspot_server', e.target.value)} placeholder="hotspot1" disabled={busy} />
            </Field>
            <Field label="DNS name" hint="Hotspot login address printed on every card">
              <TextInput value={form.dns_name} onChange={(e) => set('dns_name', e.target.value)} placeholder="hotzonex.wifi" disabled={busy} />
            </Field>
          </div>

          <Checkbox
            label="Use HTTPS (www-ssl service)"
            checked={form.use_https}
            onChange={(v) => setForm((f) => ({ ...f, use_https: v, port: f.port === (v ? '80' : '443') ? (v ? '443' : '80') : f.port }))}
          />

          {formError && <Alert tone="error">{formError}</Alert>}
          {phase.kind === 'failed' && <Alert tone="error">{phase.message}</Alert>}
          {phase.kind === 'testing' && (
            <Alert tone="info">
              <span className="flex items-center gap-2">
                <Spinner /> Testing connection to {phase.ip}… this can take up to 30 seconds.
              </span>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> {phase.kind === 'saving' ? 'Saving…' : 'Testing…'}
                </>
              ) : (
                'Save and test'
              )}
            </Button>
            <Link to="/routers" className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-slate-700 hover:bg-slate-100">
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
