import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { HotspotSetup, RouterConnectionStatus, SetupScriptCard } from '../components/RouterSetup';
import { Alert, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { invokeFunction } from '../lib/functions';
import { RouterTimeoutError, waitForJob } from '../lib/jobs';
import { useSites } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { ROUTER_COLUMNS, type RouterConnection, type RouterInfo, type TestConnectionResult } from '../lib/types';

interface FormState {
  connection: RouterConnection;
  name: string;
  site_id: string;
  hotspot_server: string;
  dns_name: string;
  host: string;
  port: string;
  use_https: boolean;
  username: string;
  password: string;
}

const EMPTY: FormState = {
  connection: 'direct',
  name: '',
  site_id: '',
  hotspot_server: 'hotspot1',
  dns_name: '',
  host: '',
  port: '443',
  use_https: true,
  username: 'admin',
  password: '',
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'testing'; routerId: string }
  | { kind: 'setup'; routerId: string; script: string }
  | { kind: 'success'; routerId: string; result: TestConnectionResult }
  | { kind: 'failed'; message: string; routerId?: string };

const PRIVATE_IP_RE = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

function ConnectionChoice({ value, onChange, disabled }: { value: RouterConnection; onChange: (v: RouterConnection) => void; disabled: boolean }) {
  const option = (v: RouterConnection, title: string, text: string) => (
    <label
      className={`flex cursor-pointer gap-3 rounded-xl p-3 ring-1 ${value === v ? 'bg-brand-50 ring-brand-500' : 'ring-slate-200 hover:bg-slate-50'}`}
    >
      <input type="radio" className="mt-1 h-5 w-5" checked={value === v} onChange={() => onChange(v)} disabled={disabled} />
      <span>
        <span className="block font-semibold text-slate-900">{title}</span>
        <span className="block text-sm text-slate-600">{text}</span>
      </span>
    </label>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {option(
        'direct',
        'IP address, username and password',
        'Hotzonex logs in to the router’s REST API. The router needs a public IP address or DNS name reachable from the internet.',
      )}
      {option(
        'cloud',
        'Router connects to Hotzonex Cloud',
        'Paste a setup script into the router once. Works behind Starlink, 4G or any network without a public IP.',
      )}
    </div>
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
        connection: r.connection,
        name: r.name,
        site_id: r.site_id,
        hotspot_server: r.hotspot_server,
        dns_name: r.dns_name,
        host: r.host ?? '',
        port: String(r.port ?? (r.use_https === false ? 80 : 443)),
        use_https: r.use_https ?? true,
        username: r.username ?? 'admin',
        password: '',
      });
    }
  }, [existing.data]);

  // Pick the only site automatically on a new router.
  useEffect(() => {
    const only = sites.data?.length === 1 ? sites.data[0] : undefined;
    if (!isEdit && !form.site_id && only) setForm((f) => ({ ...f, site_id: only.id }));
  }, [isEdit, form.site_id, sites.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const direct = form.connection === 'direct';
  const needsPassword = direct && (!isEdit || existing.data?.connection !== 'direct');

  function validate(): string | null {
    if (!form.name.trim()) return 'Router name is required.';
    if (!form.site_id) return 'Choose a site.';
    if (!form.hotspot_server.trim()) return 'Hotspot server name is required.';
    if (!form.dns_name.trim()) return 'DNS name is required.';
    if (direct) {
      const host = form.host.trim();
      if (!host) return 'Router address is required.';
      if (PRIVATE_IP_RE.test(host))
        return `${host} is a private address that only works inside the router’s own network, so Hotzonex Cloud cannot reach it. Enter the router’s public IP or DNS name, or choose “Router connects to Hotzonex Cloud”.`;
      const port = Number(form.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port must be a number from 1 to 65535.';
      if (!form.username.trim()) return 'Router username is required.';
      if (needsPassword && !form.password) return 'Router password is required.';
    }
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    setFormError(problem);
    if (problem) return;

    setPhase({ kind: 'saving' });
    const fields = {
      connection: form.connection,
      name: form.name.trim(),
      site_id: form.site_id,
      hotspot_server: form.hotspot_server.trim(),
      dns_name: form.dns_name.trim(),
      ...(direct
        ? { host: form.host.trim(), port: Number(form.port), use_https: form.use_https, username: form.username.trim(), password: form.password }
        : {}),
    };
    let routerId = id;
    try {
      const res = await invokeFunction<{ router_id: string; job_id: string; script?: string }>('add-router', {
        action: isEdit ? 'update' : 'create',
        router_id: id,
        ...fields,
      });
      routerId = res.router_id;
      setForm((f) => ({ ...f, password: '' }));
      if (res.script) {
        setPhase({ kind: 'setup', routerId: res.router_id, script: res.script });
        return;
      }
      setPhase({ kind: 'testing', routerId: res.router_id });
      const job = await waitForJob(res.job_id);
      const result = (job.result ?? {}) as TestConnectionResult;
      if (job.status === 'done') setPhase({ kind: 'success', routerId: res.router_id, result });
      else setPhase({ kind: 'failed', routerId: res.router_id, message: `${result.error ?? 'The check failed.'} The router is saved; fix the problem and save again.` });
    } catch (err) {
      if (err instanceof RouterTimeoutError) {
        setPhase({
          kind: 'failed',
          routerId,
          message: direct
            ? 'The router did not answer within a minute. It is saved and will be checked again automatically every minute.'
            : 'Your changes are saved. The router has not called in during the last minute, so they will be checked as soon as it does.',
        });
      } else {
        setPhase({ kind: 'failed', routerId, message: friendlyError(err) });
      }
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['routers'] });
      if (routerId) void queryClient.invalidateQueries({ queryKey: ['router', routerId] });
    }
  }

  if (isEdit && existing.isLoading) return <Spinner className="h-8 w-8 text-brand-600" />;
  if (isEdit && !existing.isLoading && !existing.data) return <Alert tone="error">This router no longer exists.</Alert>;

  if (phase.kind === 'setup') {
    return (
      <div className="max-w-2xl space-y-4">
        <PageHeader title={isEdit ? 'Router updated' : 'Router added'} subtitle={`${form.name.trim()} is saved. Now connect it.`} />
        <RouterConnectionStatus routerId={phase.routerId} onEdit={() => navigate(`/routers/${phase.routerId}/edit`)} />
        <SetupScriptCard script={phase.script} />
        <Button variant="secondary" onClick={() => navigate('/routers')}>
          Back to routers
        </Button>
      </div>
    );
  }

  if (phase.kind === 'success') {
    const r = phase.result;
    return (
      <div className="max-w-2xl space-y-4">
        <PageHeader title={isEdit ? 'Router updated' : 'Router added'} />
        <Card>
          <Alert tone="success">
            <strong>{form.name}</strong> is online and its hotspot was found.
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
        </Card>
        <HotspotSetup routerId={phase.routerId} />
        <Button onClick={() => navigate('/routers')}>Back to routers</Button>
      </div>
    );
  }

  const busy = phase.kind === 'saving' || phase.kind === 'testing';

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={isEdit ? 'Edit router' : 'Add router'}
        subtitle="Hotzonex reads the hotspot you already set up on the router and uses it as it is. It does not create or change your hotspot, its profiles or any other router settings."
      />

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <ConnectionChoice value={form.connection} onChange={(v) => set('connection', v)} disabled={busy} />

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

            {direct && (
              <>
                <Field label="Router address" hint="Public IP address or DNS name, e.g. 41.223.10.5 or abc123.sn.mynetname.net (Winbox → IP → Cloud)">
                  <TextInput value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="41.223.10.5" autoComplete="off" disabled={busy} />
                </Field>
                <Field label="Port" hint={form.use_https ? 'www-ssl service port (443 by default)' : 'www service port (80 by default)'}>
                  <TextInput value={form.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} inputMode="numeric" disabled={busy} />
                </Field>
                <Field label="Router username">
                  <TextInput value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" disabled={busy} />
                </Field>
                <Field label="Router password" hint={needsPassword ? undefined : 'Leave blank to keep the current password'}>
                  <TextInput
                    type="password"
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    autoComplete="new-password"
                    placeholder={needsPassword ? '' : '••••••••'}
                    disabled={busy}
                  />
                </Field>
              </>
            )}

            <Field label="Hotspot server name" hint="As on the router: IP → Hotspot → Servers (usually hotspot1, not the Wi-Fi name)">
              <TextInput value={form.hotspot_server} onChange={(e) => set('hotspot_server', e.target.value)} placeholder="hotspot1" disabled={busy} />
            </Field>
            <Field label="DNS name" hint="Hotspot login address printed on every card">
              <TextInput value={form.dns_name} onChange={(e) => set('dns_name', e.target.value)} placeholder="hotzonex.wifi" disabled={busy} />
            </Field>
          </div>

          {direct && (
            <>
              <Checkbox
                label="Use HTTPS (www-ssl) — recommended, the password crosses the internet"
                checked={form.use_https}
                onChange={(v) => setForm((f) => ({ ...f, use_https: v, port: f.port === (v ? '80' : '443') ? (v ? '443' : '80') : f.port }))}
              />
              <Alert tone="info">
                The router must answer on this address from the internet: a public IP (not behind CGNAT), the {form.use_https ? 'www-ssl' : 'www'} service on,
                and the port allowed in the router firewall. With HTTPS the router needs a trusted certificate, for example from{' '}
                <code className="rounded bg-white px-1">/certificate enable-ssl-certificate dns-name=&lt;your IP Cloud name&gt;</code>. The password is stored
                encrypted and is never shown again.
              </Alert>
            </>
          )}

          {formError && <Alert tone="error">{formError}</Alert>}
          {phase.kind === 'failed' && <Alert tone="error">{phase.message}</Alert>}
          {phase.kind === 'testing' && (
            <Alert tone="info">
              <span className="flex items-center gap-2">
                <Spinner /> Saved. Checking the router and reading its hotspot setup…
              </span>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> {phase.kind === 'saving' ? 'Saving…' : 'Checking…'}
                </>
              ) : direct ? (
                'Save and connect'
              ) : isEdit ? (
                'Save and check'
              ) : (
                'Save and get setup script'
              )}
            </Button>
            <Link to="/routers" className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-slate-700 hover:bg-slate-100">
              Cancel
            </Link>
          </div>
        </form>
      </Card>

      {phase.kind === 'failed' && phase.routerId && <HotspotSetup routerId={phase.routerId} />}
    </div>
  );
}
