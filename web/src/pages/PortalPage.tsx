import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { Alert, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { formatJubaTime } from '../lib/format';
import { RouterTimeoutError, waitForJob } from '../lib/jobs';
import {
  cleanSettings,
  DEFAULT_SETTINGS,
  MAX_LOGO_LENGTH,
  PORTAL_TEMPLATES,
  PREVIEW_VARS,
  renderLikeRouter,
  renderPortalFile,
  type PortalFile,
  type PortalSettings,
  type PortalTemplate,
} from '../lib/portal';
import { usePlans, useRouters } from '../lib/queries';
import { supabase } from '../lib/supabase';

interface PortalConfig {
  router_id: string;
  template: PortalTemplate;
  settings: Partial<PortalSettings>;
  installed_at: string | null;
  installed_dir: string | null;
  previous_dir: string | null;
  server_profile: string | null;
}

const PREVIEW_TABS: { file: PortalFile; label: string; vars?: Record<string, string> }[] = [
  { file: 'login.html', label: 'Login' },
  { file: 'login.html', label: 'Wrong code', vars: { error: 'invalid username or password', username: '1234567' } },
  { file: 'status.html', label: 'Connected', vars: { username: '3094906' } },
  { file: 'logout.html', label: 'Logged out', vars: { username: '3094906' } },
];

type Action = { kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'done'; ok: boolean; message: string };

export function PortalPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const routers = useRouters();
  const plans = usePlans();
  const [routerId, setRouterId] = useState('');
  const [template, setTemplate] = useState<PortalTemplate>('classic');
  const [settings, setSettings] = useState<PortalSettings>(DEFAULT_SETTINGS);
  const [tab, setTab] = useState(0);
  const [action, setAction] = useState<Action>({ kind: 'idle' });
  const [logoError, setLogoError] = useState<string | null>(null);

  useEffect(() => {
    const list = routers.data ?? [];
    if (!routerId && list.length) setRouterId(list[0]!.id);
  }, [routers.data, routerId]);

  const config = useQuery({
    queryKey: ['portal-config', routerId],
    enabled: Boolean(routerId),
    queryFn: async (): Promise<PortalConfig | null> => {
      const { data, error } = await supabase.from('portal_configs').select('*').eq('router_id', routerId).maybeSingle();
      if (error) throw new Error(error.message);
      return data as PortalConfig | null;
    },
  });

  useEffect(() => {
    if (config.isLoading) return;
    const c = config.data;
    setTemplate(c?.template ?? 'classic');
    setSettings(cleanSettings(c?.settings ?? {}));
  }, [config.data, config.isLoading]);

  const set = <K extends keyof PortalSettings>(key: K, value: PortalSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const activePlans = useMemo(() => (plans.data ?? []).filter((p) => p.is_active).sort((a, b) => a.price_ssp - b.price_ssp), [plans.data]);
  const router = (routers.data ?? []).find((r) => r.id === routerId);
  const current = PREVIEW_TABS[tab] ?? PREVIEW_TABS[0]!;
  const preview = useMemo(
    () => renderLikeRouter(renderPortalFile(current.file, template, settings, activePlans), { ...PREVIEW_VARS, ...(current.vars ?? {}) }),
    [current, template, settings, activePlans],
  );

  function onLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      setLogoError('Use a PNG, JPG, GIF or WebP picture.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (url.length > MAX_LOGO_LENGTH) {
        setLogoError('The picture is too big. Use one under about 100 KB (customers load it before they are online).');
        return;
      }
      setLogoError(null);
      set('logoDataUrl', url);
    };
    reader.readAsDataURL(file);
  }

  async function save(): Promise<void> {
    const { error } = await supabase
      .from('portal_configs')
      .upsert({ router_id: routerId, template, settings: cleanSettings(settings), updated_at: new Date().toISOString() });
    if (error) throw new Error(friendlyError(error));
  }

  async function runJob(type: 'install_portal' | 'restore_portal', label: string, success: string) {
    setAction({ kind: 'busy', label });
    try {
      if (type === 'install_portal') await save();
      const { data, error } = await supabase.from('router_jobs').insert({ router_id: routerId, type, payload: {}, created_by: profile?.id }).select('id').single();
      if (error) throw new Error(friendlyError(error));
      const job = await waitForJob(data.id, 120_000);
      const result = (job.result ?? {}) as { error?: string };
      setAction(job.status === 'done' ? { kind: 'done', ok: true, message: success } : { kind: 'done', ok: false, message: result.error ?? 'The router could not finish.' });
    } catch (err) {
      setAction({
        kind: 'done',
        ok: false,
        message: err instanceof RouterTimeoutError ? 'The router did not answer within 2 minutes. Check that it is online, then try again.' : friendlyError(err),
      });
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['portal-config', routerId] });
    }
  }

  async function onSave() {
    setAction({ kind: 'busy', label: 'Saving…' });
    try {
      await save();
      setAction({ kind: 'done', ok: true, message: config.data?.installed_at ? 'Saved. Press "Install on router" to update the pages on the router.' : 'Saved.' });
      void queryClient.invalidateQueries({ queryKey: ['portal-config', routerId] });
    } catch (err) {
      setAction({ kind: 'done', ok: false, message: friendlyError(err) });
    }
  }

  const busy = action.kind === 'busy';
  const c = config.data;

  return (
    <div className="space-y-4">
      <PageHeader title="Login Portal" subtitle="The page customers see when they join your WiFi. It accepts every voucher on the router — Hotzonex and MikroTicket alike." />

      {(routers.data ?? []).length > 1 && (
        <Card>
          <Field label="Router">
            <Select value={routerId} onChange={(e) => setRouterId(e.target.value)}>
              {(routers.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
      )}
      {routers.data?.length === 0 && <Alert tone="info">Add a router first (Routers → Add router).</Alert>}

      {router && (
        <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
          <div className="space-y-4">
            <Card>
              <h2 className="text-lg font-bold">Template</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {PORTAL_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplate(t.id)}
                    className={`rounded-xl p-3 text-left ring-2 ${template === t.id ? 'bg-brand-50 ring-brand-600' : 'ring-slate-200 hover:bg-slate-50'}`}
                  >
                    <span className="block font-semibold">{t.name}</span>
                    <span className="block text-sm text-slate-600">{t.description}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="text-lg font-bold">Your details</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Business name">
                  <TextInput value={settings.businessName} onChange={(e) => set('businessName', e.target.value)} maxLength={60} />
                </Field>
                <Field label="Welcome line">
                  <TextInput value={settings.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={120} />
                </Field>
                <Field label="Main colour">
                  <input type="color" className="h-11 w-full cursor-pointer rounded-xl" value={settings.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} />
                </Field>
                <Field label="Background colour" hint="Used by the Classic and Bold templates">
                  <input type="color" className="h-11 w-full cursor-pointer rounded-xl" value={settings.backgroundColor} onChange={(e) => set('backgroundColor', e.target.value)} />
                </Field>
                <Field label="Contact line" hint="e.g. Call or WhatsApp 0912 345 678">
                  <TextInput value={settings.contact} onChange={(e) => set('contact', e.target.value)} maxLength={120} />
                </Field>
                <Field label="Footer">
                  <TextInput value={settings.footer} onChange={(e) => set('footer', e.target.value)} maxLength={160} />
                </Field>
                <Field label="Logo" hint="Small PNG/JPG, under about 100 KB">
                  <div className="flex items-center gap-3">
                    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onLogo} className="text-sm" />
                    {settings.logoDataUrl && (
                      <Button variant="secondary" onClick={() => set('logoDataUrl', null)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </Field>
                <Field label="Login box">
                  <Select value={settings.loginMode} onChange={(e) => set('loginMode', e.target.value === 'userpass' ? 'userpass' : 'code')}>
                    <option value="code">Voucher code only (with “I have a password” link)</option>
                    <option value="userpass">Username and password</option>
                  </Select>
                </Field>
              </div>
              <div className="mt-3">
                <Checkbox label="Show plans and prices" checked={settings.showPlans} onChange={(v) => set('showPlans', v)} />
              </div>
              {logoError && (
                <div className="mt-3">
                  <Alert tone="error">{logoError}</Alert>
                </div>
              )}
            </Card>

            <Card>
              <h2 className="text-lg font-bold">On the router</h2>
              {config.isLoading ? (
                <Spinner />
              ) : c?.installed_at ? (
                <p className="mt-1 text-sm text-slate-700">
                  Installed on <strong>{router.name}</strong> {formatJubaTime(c.installed_at)} in folder <code>{c.installed_dir}</code> (hotspot profile{' '}
                  <code>{c.server_profile}</code>). Previous login page folder: <code>{c.previous_dir ?? 'unknown'}</code>.
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-700">
                  Not installed. The router keeps its current login page{c?.previous_dir ? ` (folder ${c.previous_dir})` : ''} until you press Install.
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Install downloads the pages into a new <code>hotzonex</code> folder on the router and then switches the hotspot to it — the only setting it
                changes. Your old pages are not deleted. “Switch back” returns to them at any time. The router must be online.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={onSave} disabled={busy}>
                  Save
                </Button>
                <Button onClick={() => void runJob('install_portal', 'Installing on the router…', 'Installed. Customers now see this login page.')} disabled={busy}>
                  {c?.installed_at ? 'Update on router' : 'Install on router'}
                </Button>
                {c?.installed_at && c.previous_dir && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Switch ${router.name} back to its previous login page (${c.previous_dir})?`))
                        void runJob('restore_portal', 'Switching back…', 'Switched back to the previous login page.');
                    }}
                  >
                    Switch back to previous page
                  </Button>
                )}
              </div>
              {action.kind === 'busy' && (
                <div className="mt-3">
                  <Alert tone="info">
                    <span className="flex items-center gap-2">
                      <Spinner /> {action.label}
                    </span>
                  </Alert>
                </div>
              )}
              {action.kind === 'done' && (
                <div className="mt-3">
                  <Alert tone={action.ok ? 'success' : 'error'}>{action.message}</Alert>
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {PREVIEW_TABS.map((t, i) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setTab(i)}
                  className={`min-h-11 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === i ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="mx-auto w-[360px] max-w-full overflow-hidden rounded-[2rem] border-8 border-slate-900 shadow-xl">
              <iframe title="Portal preview" sandbox="" srcDoc={preview} className="h-[640px] w-full bg-white" />
            </div>
            <p className="text-center text-xs text-slate-500">Preview — what a customer’s phone shows.</p>
          </div>
        </div>
      )}
    </div>
  );
}
