import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { RouterConnectionStatus, SetupScriptCard } from '../components/RouterSetup';
import { Alert, Button, Card, Field, Select, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { invokeFunction } from '../lib/functions';
import { RouterTimeoutError, waitForJob } from '../lib/jobs';
import { useSites } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { ROUTER_COLUMNS, type RouterInfo, type TestConnectionResult } from '../lib/types';

interface FormState {
  name: string;
  site_id: string;
  hotspot_server: string;
  dns_name: string;
}

const EMPTY: FormState = { name: '', site_id: '', hotspot_server: 'hotspot1', dns_name: '' };

type Phase =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'testing' }
  | { kind: 'setup'; routerId: string; script: string }
  | { kind: 'success'; result: TestConnectionResult }
  | { kind: 'failed'; message: string };

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
    if (r) setForm({ name: r.name, site_id: r.site_id, hotspot_server: r.hotspot_server, dns_name: r.dns_name });
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
    const fields = {
      name: form.name.trim(),
      site_id: form.site_id,
      hotspot_server: form.hotspot_server.trim(),
      dns_name: form.dns_name.trim(),
    };
    try {
      if (!isEdit) {
        const { router_id, script } = await invokeFunction<{ router_id: string; job_id: string; script: string }>('add-router', {
          action: 'create',
          ...fields,
        });
        setPhase({ kind: 'setup', routerId: router_id, script });
        return;
      }

      const { job_id } = await invokeFunction<{ router_id: string; job_id: string }>('add-router', { action: 'update', router_id: id, ...fields });
      setPhase({ kind: 'testing' });
      const job = await waitForJob(job_id);
      const result = (job.result ?? {}) as TestConnectionResult;
      if (job.status === 'done') setPhase({ kind: 'success', result });
      else setPhase({ kind: 'failed', message: `${result.error ?? 'The check failed.'} Your changes are saved.` });
    } catch (err) {
      if (err instanceof RouterTimeoutError) {
        setPhase({
          kind: 'failed',
          message: 'Your changes are saved. The router has not called in during the last minute, so they will be checked as soon as it does.',
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
  if (isEdit && !existing.isLoading && !existing.data) return <Alert tone="error">This router no longer exists.</Alert>;

  if (phase.kind === 'setup') {
    return (
      <div className="max-w-2xl space-y-4">
        <PageHeader title="Router added" subtitle={`${form.name.trim()} is saved. Now connect it.`} />
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
        <PageHeader title="Router updated" />
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
          <div className="mt-5">
            <Button onClick={() => navigate('/routers')}>Back to routers</Button>
          </div>
        </Card>
      </div>
    );
  }

  const busy = phase.kind === 'saving' || phase.kind === 'testing';

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={isEdit ? 'Edit router' : 'Add router'}
        subtitle={
          isEdit
            ? 'The router checks the new settings the next time it calls in.'
            : 'After saving you get a setup script to paste into the router. No IP address or router password is needed.'
        }
      />

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
            <Field label="Hotspot server name" hint="Winbox → IP → Hotspot → Servers, usually hotspot1 (not the Wi-Fi name)">
              <TextInput value={form.hotspot_server} onChange={(e) => set('hotspot_server', e.target.value)} placeholder="hotspot1" disabled={busy} />
            </Field>
            <Field label="DNS name" hint="Hotspot login address printed on every card">
              <TextInput value={form.dns_name} onChange={(e) => set('dns_name', e.target.value)} placeholder="hotzonex.wifi" disabled={busy} />
            </Field>
          </div>

          {formError && <Alert tone="error">{formError}</Alert>}
          {phase.kind === 'failed' && <Alert tone="error">{phase.message}</Alert>}
          {phase.kind === 'testing' && (
            <Alert tone="info">
              <span className="flex items-center gap-2">
                <Spinner /> Saved. Waiting for the router to check the new settings (it calls in every 30 seconds)…
              </span>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> {phase.kind === 'saving' ? 'Saving…' : 'Checking…'}
                </>
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
    </div>
  );
}
