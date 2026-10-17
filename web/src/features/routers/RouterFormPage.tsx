import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HotspotSetup, RouterConnectionStatus, SetupScriptCard } from '../../components/RouterSetup';
import { useTunnelServer } from '../../hooks/useTunnelServer';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Button, Field, Select, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { invokeFunction } from '../../lib/functions';
import { RouterTimeoutError, waitForJob } from '../../lib/jobs';
import { useSites } from '../../hooks/queries';
import { supabase } from '../../lib/supabase';
import { ROUTER_COLUMNS, type RouterConnection, type RouterInfo, type TestConnectionResult } from '../../lib/types';
import { routerSchema } from '../../lib/validation';

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
      if (error) throw new Error(friendlyError(error));
      return data as RouterInfo | null;
    },
  });

  // Fill the form once per router: ['router', id] is refetched every few seconds while the hotspot
  // setup is shown, and re-filling would wipe what the user is typing (including the password).
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const r = existing.data;
    if (r && seededFor.current !== r.id) {
      seededFor.current = r.id;
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
    <PageHeader
      title={title}
      actions={
        <Button variant="ghost" onClick={() => navigate('/routers')}>
          ← Routers
        </Button>
      }
    />
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
    <div className="max-w-3xl space-y-4">
      {header(switchToTunnel ? 'Switch to tunnel' : isEdit ? 'Edit router' : 'New router')}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
          <div className="min-w-0 flex-1">
            <Field label="Address">
              <TextInput value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="192.168.88.1" autoComplete="off" disabled={busy} />
            </Field>
          </div>
          <div className="w-28">
            <Field label="Port">
              <TextInput value={form.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} inputMode="numeric" disabled={busy} />
            </Field>
          </div>
        </div>

        <Field label="Username">
          <TextInput value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" disabled={busy} />
        </Field>

        <Field label="Password">
          <div className="flex items-center gap-2">
            <TextInput
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder={hasPassword ? 'Leave blank to keep the current password' : ''}
              autoComplete="new-password"
              disabled={busy}
            />
            <Button variant="ghost" className="shrink-0" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Hide' : 'Show'}
            </Button>
          </div>
        </Field>

        <Field label="Comment">
          <TextInput value={form.comment} onChange={(e) => set('comment', e.target.value)} placeholder="e.g. Jebel Iraq main" maxLength={60} disabled={busy} />
        </Field>

        {activeSites.length > 1 && (
          <Field label="Site">
            <Select value={form.site_id} onChange={(e) => set('site_id', e.target.value)} disabled={busy}>
              <option value="">Choose a site…</option>
              {activeSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {isEdit && servers.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hotspot (on the router)">
              <Select value={form.hotspot_server} onChange={(e) => set('hotspot_server', e.target.value)} disabled={busy}>
                {servers.map((h) => (
                  <option key={h.name} value={h.name} disabled={h.disabled}>
                    {h.name}
                    {h.disabled ? ' (switched off)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Login address on cards">
              <TextInput value={form.dns_name} onChange={(e) => set('dns_name', e.target.value)} placeholder="hotzonex.wifi" disabled={busy} />
            </Field>
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

        <Button type="submit" disabled={busy} className="min-h-14 w-full text-lg">
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
        </Button>

        <p className="text-center text-sm text-slate-500">
          Hotzonex uses the hotspot already set up on your router and never changes it or its profiles. Plans and vouchers are managed here in Hotzonex.
        </p>
      </form>

      {phase.kind === 'failed' && phase.routerId && <HotspotSetup routerId={phase.routerId} />}
    </div>
  );
}
