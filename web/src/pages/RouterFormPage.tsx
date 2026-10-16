import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HotspotSetup, RouterConnectionStatus, SetupScriptCard } from '../components/RouterSetup';
import { useTunnelServer } from '../components/TunnelServer';
import { Alert, Button, Spinner } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { invokeFunction } from '../lib/functions';
import { RouterTimeoutError, waitForJob } from '../lib/jobs';
import { useSites } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { ROUTER_COLUMNS, type RouterConnection, type RouterInfo, type TestConnectionResult } from '../lib/types';
import { routerSchema } from '../lib/validation';

interface FormState {
  host: string;
  port: string;
  username: string;
  password: string;
  comment: string;
  site_id: string;
  hotspot_server: string;
  dns_name: string;
}

const EMPTY: FormState = { host: '', port: '80', username: 'admin', password: '', comment: '', site_id: '', hotspot_server: '', dns_name: '' };

type Phase =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'testing'; routerId: string }
  | { kind: 'setup'; routerId: string; script: string; host: string; connection: RouterConnection }
  | { kind: 'success'; routerId: string; result: TestConnectionResult }
  | { kind: 'failed'; message: string; routerId?: string };

/** Outlined field with the label sitting on the border, like the MikroTik apps. */
function Outlined({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`relative block rounded-2xl border-2 border-slate-800 px-4 pb-2 pt-3 focus-within:border-brand-600 ${className}`}>
      <span className="absolute -top-2.5 left-3 bg-white px-1 text-sm text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const inputClass = 'min-h-11 w-full bg-transparent py-1 text-lg text-slate-900 outline-none placeholder:text-slate-500 disabled:text-slate-500';

export function RouterFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sites = useSites();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [formError, setFormError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const tunnelServer = useTunnelServer();
  const tunnelReady = Boolean(tunnelServer.data?.ready);

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
        host: r.host ?? '',
        port: String(r.port ?? 80),
        username: r.username ?? 'admin',
        password: '',
        comment: r.name === r.host ? '' : r.name,
        site_id: r.site_id,
        hotspot_server: r.hotspot_server ?? '',
        dns_name: r.dns_name ?? '',
      });
    }
  }, [existing.data]);

  const activeSites = useMemo(() => sites.data ?? [], [sites.data]);
  useEffect(() => {
    if (!form.site_id && activeSites.length === 1) setForm((f) => ({ ...f, site_id: activeSites[0]!.id }));
  }, [form.site_id, activeSites]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const hasPassword = isEdit && (existing.data?.connection === 'direct' || existing.data?.connection === 'tunnel');
  // Moving a script-connected router to the tunnel (no scheduler on the router).
  const switchToTunnel = isEdit && existing.data?.connection === 'cloud' && tunnelReady && searchParams.get('tunnel') === '1';

  function validate(): string | null {
    const result = routerSchema(switchToTunnel).safeParse({ ...form, port: form.port || '80' });
    return result.success ? null : (result.error.issues[0]?.message ?? 'Please check the form.');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    setFormError(problem);
    if (problem) return;

    setPhase({ kind: 'saving' });
    let routerId = id;
    try {
      const res = await invokeFunction<{ router_id: string; job_id: string; connection: RouterConnection; script?: string }>('add-router', {
        action: switchToTunnel ? 'tunnel_switch' : isEdit ? 'update' : 'create',
        router_id: id,
        host: form.host.trim(),
        port: Number(form.port || '80'),
        username: form.username.trim(),
        password: form.password,
        comment: form.comment.trim(),
        site_id: form.site_id,
        ...(isEdit ? { hotspot_server: form.hotspot_server, dns_name: form.dns_name.trim() } : {}),
      });
      routerId = res.router_id;
      setForm((f) => ({ ...f, password: '' }));
      if (res.script) {
        setPhase({ kind: 'setup', routerId: res.router_id, script: res.script, host: form.host.trim(), connection: res.connection });
        return;
      }
      // Direct routers are checked straight away; script-connected ones on their next call.
      setPhase({ kind: 'testing', routerId: res.router_id });
      const job = await waitForJob(res.job_id);
      const result = (job.result ?? {}) as TestConnectionResult;
      if (job.status === 'done') setPhase({ kind: 'success', routerId: res.router_id, result });
      else setPhase({ kind: 'failed', routerId: res.router_id, message: result.error ?? 'The router check failed.' });
    } catch (err) {
      setPhase({
        kind: 'failed',
        routerId,
        message: err instanceof RouterTimeoutError ? 'The router did not answer within a minute. It is saved and will be checked again automatically.' : friendlyError(err),
      });
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['routers'] });
      if (routerId) void queryClient.invalidateQueries({ queryKey: ['router', routerId] });
    }
  }

  if (isEdit && existing.isLoading) return <Spinner className="h-8 w-8 text-brand-600" />;
  if (isEdit && !existing.isLoading && !existing.data) return <Alert tone="error">This router no longer exists.</Alert>;

  const header = (title: string) => (
    <div className="-mx-4 -mt-4 mb-6 border-b-2 border-brand-600 bg-slate-50 px-4 py-4 sm:-mx-6 sm:px-6">
      <div className="flex items-center gap-4">
        <button type="button" aria-label="Back" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-2xl text-slate-800 hover:bg-slate-200" onClick={() => navigate('/routers')}>
          ←
        </button>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      </div>
    </div>
  );

  if (phase.kind === 'setup') {
    return (
      <div className="max-w-2xl space-y-4">
        {header('Connect router')}
        {phase.connection === 'tunnel' ? (
          <Alert tone="info">
            <strong>{phase.host}</strong> is an address inside your router’s own network, so Hotzonex reaches the router through your tunnel server. Paste
            this script into the router once: it checks that your hotspot is set up and running, then opens a WireGuard tunnel that stays up by itself. No
            scheduler is added, and your hotspot and its profiles are not changed.
          </Alert>
        ) : (
          <Alert tone="info">
            <strong>{phase.host}</strong> is an address inside your router’s own network, so Hotzonex Cloud cannot open it from the internet. Connect the
            router once with this script: it checks that your hotspot is already set up and running, then lets the router talk to Hotzonex Cloud. It does not
            change your hotspot or its profiles.
          </Alert>
        )}
        <RouterConnectionStatus routerId={phase.routerId} onEdit={() => navigate(`/routers/${phase.routerId}/edit`)} />
        <SetupScriptCard script={phase.script} kind={phase.connection === 'tunnel' ? 'tunnel' : 'cloud'} />
        <HotspotSetup routerId={phase.routerId} />
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
        {header(isEdit ? 'Router updated' : 'Router connected')}
        <Alert tone="success">
          Connected. {r.model ?? ''} · RouterOS {r.ros_version ?? '?'} · using hotspot <strong>{r.hotspot_server ?? '?'}</strong> · login address{' '}
          <strong>{r.dns_name ?? '?'}</strong>
        </Alert>
        {(r.warnings ?? []).map((w) => (
          <Alert key={w} tone="warning">
            {w}
          </Alert>
        ))}
        <HotspotSetup routerId={phase.routerId} />
        <Button onClick={() => navigate('/routers')}>Back to routers</Button>
      </div>
    );
  }

  const busy = phase.kind === 'saving' || phase.kind === 'testing';
  const servers = existing.data?.hotspot_info?.servers ?? [];

  return (
    <div className="max-w-3xl">
      {header(switchToTunnel ? 'Switch to tunnel' : isEdit ? 'Edit Router' : 'New Router')}

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {switchToTunnel && (
          <Alert tone="info">
            Hotzonex will reach this router through your tunnel server instead of the <code>hzc-cloud</code> scheduler. Enter the router’s login and the port
            of its <strong>www</strong> service (Winbox → IP → Services → www; yours may be 87), then paste the tunnel script you get next. The script removes
            the scheduler.
          </Alert>
        )}
        {!isEdit && tunnelReady && (
          <p className="text-sm text-slate-600">
            Your tunnel server is ready: a router at a local address (like 192.168.88.1) is connected through it, with no scheduler. Port = the router’s{' '}
            <strong>www</strong> service port (Winbox → IP → Services).
          </p>
        )}
        <div className="flex gap-3">
          <Outlined label="Address" className="flex-1">
            <input className={inputClass} value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="192.168.88.1" autoComplete="off" disabled={busy} />
          </Outlined>
          <Outlined label="Port" className="w-28">
            <input className={inputClass} value={form.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} inputMode="numeric" disabled={busy} />
          </Outlined>
        </div>

        <Outlined label="Username">
          <input className={inputClass} value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" disabled={busy} />
        </Outlined>

        <Outlined label="Password">
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder={hasPassword ? 'Leave blank to keep the current password' : ''}
              autoComplete="new-password"
              disabled={busy}
            />
            <button type="button" className="min-h-11 px-2 text-sm font-semibold text-slate-700" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </Outlined>

        <Outlined label="Comment">
          <input className={inputClass} value={form.comment} onChange={(e) => set('comment', e.target.value)} placeholder="e.g. Jebel Iraq main" maxLength={60} disabled={busy} />
        </Outlined>

        {activeSites.length > 1 && (
          <Outlined label="Site">
            <select className={inputClass} value={form.site_id} onChange={(e) => set('site_id', e.target.value)} disabled={busy}>
              <option value="">Choose a site…</option>
              {activeSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Outlined>
        )}

        {isEdit && servers.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2">
            <Outlined label="Hotspot (on the router)">
              <select className={inputClass} value={form.hotspot_server} onChange={(e) => set('hotspot_server', e.target.value)} disabled={busy}>
                {servers.map((h) => (
                  <option key={h.name} value={h.name} disabled={h.disabled}>
                    {h.name}
                    {h.disabled ? ' (switched off)' : ''}
                  </option>
                ))}
              </select>
            </Outlined>
            <Outlined label="Login address on cards">
              <input className={inputClass} value={form.dns_name} onChange={(e) => set('dns_name', e.target.value)} placeholder="hotzonex.wifi" disabled={busy} />
            </Outlined>
          </div>
        )}

        {formError && <Alert tone="error">{formError}</Alert>}
        {phase.kind === 'failed' && <Alert tone="error">{phase.message}</Alert>}
        {phase.kind === 'testing' && (
          <Alert tone="info">
            <span className="flex items-center gap-2">
              <Spinner /> Connecting and reading the router’s hotspot setup…
            </span>
          </Alert>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-lg font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? (
            <>
              <Spinner /> {phase.kind === 'saving' ? 'Saving…' : 'Connecting…'}
            </>
          ) : switchToTunnel ? (
            'Switch to tunnel'
          ) : isEdit ? (
            'Save'
          ) : (
            'Connect'
          )}
        </button>

        <p className="text-center text-sm text-slate-500">
          Hotzonex uses the hotspot already set up on your router and never changes it or its profiles. Plans and vouchers are managed here in Hotzonex.
        </p>
      </form>

      {phase.kind === 'failed' && phase.routerId && (
        <div className="mt-6">
          <HotspotSetup routerId={phase.routerId} />
        </div>
      )}
    </div>
  );
}
