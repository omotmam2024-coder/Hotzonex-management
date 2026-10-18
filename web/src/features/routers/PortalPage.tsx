import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatJubaTime } from '../../lib/format';
import { RouterTimeoutError, waitForJob } from '../../lib/jobs';
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
} from '../../lib/portal';
import { usePlans, useRouters } from '../../hooks/queries';
import { supabase } from '../../lib/supabase';
import { rich } from '../../components/RouterSetup';
import { useT, type TKey } from '../../i18n';
import { translate } from '../../i18n/translate';

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
  {
    file: 'login.html',
    get label() {
      return translate('routers.portal.tab.login');
    },
  },
  {
    file: 'login.html',
    get label() {
      return translate('routers.portal.tab.wrongCode');
    },
    vars: { error: 'invalid username or password', username: '1234567' },
  },
  {
    file: 'status.html',
    get label() {
      return translate('routers.portal.tab.connected');
    },
    vars: { username: '3094906' },
  },
  {
    file: 'logout.html',
    get label() {
      return translate('routers.portal.tab.loggedOut');
    },
    vars: { username: '3094906' },
  },
];

/** The template names and descriptions shown on this page, in the chosen language. */
const TEMPLATE_TEXT: Record<PortalTemplate, { name: TKey; description: TKey }> = {
  classic: { name: 'routers.portal.tpl.classic', description: 'routers.portal.tpl.classicDesc' },
  bold: { name: 'routers.portal.tpl.bold', description: 'routers.portal.tpl.boldDesc' },
  minimal: { name: 'routers.portal.tpl.minimal', description: 'routers.portal.tpl.minimalDesc' },
};

type Action = { kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'done'; ok: boolean; message: string };

/** The settings as a plain object type: an interface has no index signature, so it is not `Json` as declared. */
const asJsonObject = (s: PortalSettings): { [K in keyof PortalSettings]: PortalSettings[K] } => s;

export function PortalPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useT();
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
      setLogoError(t('routers.portal.logoType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (url.length > MAX_LOGO_LENGTH) {
        setLogoError(t('routers.portal.logoBig'));
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
      .upsert({ router_id: routerId, template, settings: asJsonObject(cleanSettings(settings)), updated_at: new Date().toISOString() });
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
      setAction(job.status === 'done' ? { kind: 'done', ok: true, message: success } : { kind: 'done', ok: false, message: result.error ?? t('routers.portal.couldNotFinish') });
    } catch (err) {
      setAction({
        kind: 'done',
        ok: false,
        message: err instanceof RouterTimeoutError ? t('routers.portal.timeout') : friendlyError(err),
      });
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['portal-config', routerId] });
    }
  }

  async function onSave() {
    setAction({ kind: 'busy', label: t('common.saving') });
    try {
      await save();
      setAction({ kind: 'done', ok: true, message: config.data?.installed_at ? t('routers.portal.savedInstall') : t('routers.portal.saved') });
      void queryClient.invalidateQueries({ queryKey: ['portal-config', routerId] });
    } catch (err) {
      setAction({ kind: 'done', ok: false, message: friendlyError(err) });
    }
  }

  const busy = action.kind === 'busy';
  const c = config.data;

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.portal')} subtitle={t('routers.portal.subtitle')} />

      {(routers.data ?? []).length > 1 && (
        <Card>
          <Field label={t('common.router')}>
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
      {routers.data?.length === 0 && <Alert tone="info">{t('routers.portal.addRouterFirst')}</Alert>}

      {router && (
        <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
          <div className="space-y-4">
            <Card>
              <h2 className="text-lg font-bold">{t('routers.portal.template')}</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {PORTAL_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setTemplate(tpl.id)}
                    className={`rounded-xl p-3 text-start ring-2 ${template === tpl.id ? 'bg-brand-50 ring-brand-600' : 'ring-slate-200 hover:bg-slate-50'}`}
                  >
                    <span className="block font-semibold">{t(TEMPLATE_TEXT[tpl.id].name)}</span>
                    <span className="block text-sm text-slate-600">{t(TEMPLATE_TEXT[tpl.id].description)}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="text-lg font-bold">{t('routers.portal.yourDetails')}</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label={t('routers.portal.businessName')}>
                  <TextInput value={settings.businessName} onChange={(e) => set('businessName', e.target.value)} maxLength={60} />
                </Field>
                <Field label={t('routers.portal.welcomeLine')}>
                  <TextInput value={settings.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={120} />
                </Field>
                <Field label={t('routers.portal.mainColour')}>
                  <input type="color" className="h-11 w-full cursor-pointer rounded-xl" value={settings.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} />
                </Field>
                <Field label={t('routers.portal.bgColour')} hint={t('routers.portal.bgHint')}>
                  <input type="color" className="h-11 w-full cursor-pointer rounded-xl" value={settings.backgroundColor} onChange={(e) => set('backgroundColor', e.target.value)} />
                </Field>
                <Field label={t('routers.portal.contact')} hint={t('routers.portal.contactHint')}>
                  <TextInput value={settings.contact} onChange={(e) => set('contact', e.target.value)} maxLength={120} />
                </Field>
                <Field label={t('routers.portal.footer')}>
                  <TextInput value={settings.footer} onChange={(e) => set('footer', e.target.value)} maxLength={160} />
                </Field>
                <Field label={t('routers.portal.logo')} hint={t('routers.portal.logoHint')}>
                  <div className="flex items-center gap-3">
                    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onLogo} className="text-sm" />
                    {settings.logoDataUrl && (
                      <Button variant="secondary" onClick={() => set('logoDataUrl', null)}>
                        {t('common.remove')}
                      </Button>
                    )}
                  </div>
                </Field>
                <Field label={t('routers.portal.loginBox')}>
                  <Select value={settings.loginMode} onChange={(e) => set('loginMode', e.target.value === 'userpass' ? 'userpass' : 'code')}>
                    <option value="code">{t('routers.portal.modeCode')}</option>
                    <option value="userpass">{t('routers.portal.modeUserpass')}</option>
                  </Select>
                </Field>
              </div>
              <div className="mt-3">
                <Checkbox label={t('routers.portal.showPlans')} checked={settings.showPlans} onChange={(v) => set('showPlans', v)} />
              </div>
              {logoError && (
                <div className="mt-3">
                  <Alert tone="error">{logoError}</Alert>
                </div>
              )}
            </Card>

            <Card>
              <h2 className="text-lg font-bold">{t('routers.portal.onRouter')}</h2>
              {config.isLoading ? (
                <Spinner />
              ) : c?.installed_at ? (
                <p className="mt-1 text-sm text-slate-700">
                  {rich(t('routers.portal.installedLine', { time: formatJubaTime(c.installed_at) }), {
                    router: <strong>{router.name}</strong>,
                    dir: <code dir="ltr">{c.installed_dir}</code>,
                    profile: <code dir="ltr">{c.server_profile}</code>,
                    prev: c.previous_dir ? <code dir="ltr">{c.previous_dir}</code> : <code>{t('routers.portal.unknown')}</code>,
                  })}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-700">
                  {t('routers.portal.notInstalled', { folder: c?.previous_dir ? t('routers.portal.folder', { dir: c.previous_dir }) : '' })}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                {rich(t('routers.portal.installHelp'), { folder: <code dir="ltr">hotzonex</code> })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={onSave} disabled={busy}>
                  {t('common.save')}
                </Button>
                <Button onClick={() => void runJob('install_portal', t('routers.portal.installing'), t('routers.portal.installed'))} disabled={busy}>
                  {c?.installed_at ? t('routers.portal.updateOnRouter') : t('routers.portal.installOnRouter')}
                </Button>
                {c?.installed_at && c.previous_dir && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t('routers.portal.confirmSwitchBack', { name: router.name, dir: c.previous_dir })))
                        void runJob('restore_portal', t('routers.portal.switchingBack'), t('routers.portal.switchedBack'));
                    }}
                  >
                    {t('routers.portal.switchBack')}
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
              {PREVIEW_TABS.map((tab_, i) => (
                <button
                  key={tab_.file + i}
                  type="button"
                  onClick={() => setTab(i)}
                  className={`min-h-11 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === i ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  {tab_.label}
                </button>
              ))}
            </div>
            <div className="mx-auto w-[360px] max-w-full overflow-hidden rounded-[2rem] border-8 border-slate-900 shadow-xl">
              <iframe title={t('routers.portal.previewTitle')} sandbox="" srcDoc={preview} className="h-[640px] w-full bg-white" />
            </div>
            <p className="text-center text-xs text-slate-500">{t('routers.portal.previewNote')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
