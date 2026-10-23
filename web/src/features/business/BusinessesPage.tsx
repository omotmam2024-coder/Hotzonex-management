import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlatformBilling } from '../../components/PlatformBilling';
import { RemoveBusiness, type RemovedBusiness } from '../../components/RemoveBusiness';
import { WhatsAppSender } from '../../components/WhatsAppSender';
import { BillingMessages } from '../../components/BillingMessages';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Field, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { useT } from '../../i18n';
import { invokeFunction } from '../../lib/functions';
import { supabase } from '../../lib/supabase';

interface BusinessRow {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  is_active: boolean;
  created_at: string;
  sites: number;
  routers: number;
  staff: number;
  admin_names: string | null;
}

interface BusinessForm {
  business_name: string;
  site_name: string;
  timezone: string;
  full_name: string;
  email: string;
  password: string;
}

const NEW_FORM: BusinessForm = { business_name: '', site_name: '', timezone: 'Africa/Juba', full_name: '', email: '', password: '' };

function NewBusiness({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BusinessForm>(NEW_FORM);
  const set = <K extends keyof BusinessForm>(key: K, value: BusinessForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const create = useMutation({
    mutationFn: async () => {
      if (!form.business_name.trim()) throw new Error(t('business.newBusiness.errName'));
      if (!form.full_name.trim() || !form.email.trim()) throw new Error(t('business.newBusiness.errAdmin'));
      if (form.password.length < 8) throw new Error(t('business.newBusiness.errPassword'));
      await invokeFunction('create-staff', {
        action: 'create_business',
        business_name: form.business_name.trim(),
        site_name: form.site_name.trim(),
        timezone: form.timezone.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['businesses'] });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">{t('business.newBusiness.title')}</h2>
      <p className="mb-4 text-sm text-slate-600">{t('business.newBusiness.text')}</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('business.settings.name')}>
            <TextInput value={form.business_name} onChange={(e) => set('business_name', e.target.value)} maxLength={100} />
          </Field>
          <Field label={t('business.newBusiness.firstSite')} hint={t('business.newBusiness.firstSiteHint')}>
            <TextInput value={form.site_name} onChange={(e) => set('site_name', e.target.value)} maxLength={80} />
          </Field>
          <Field label={t('business.newBusiness.timezone')} hint={t('business.newBusiness.timezoneHint')}>
            <TextInput value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Africa/Juba" dir="ltr" />
          </Field>
          <Field label={t('business.newBusiness.ownerName')}>
            <TextInput value={form.full_name} onChange={(e) => set('full_name', e.target.value)} maxLength={80} />
          </Field>
          <Field label={t('business.newBusiness.ownerEmail')}>
            <TextInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" dir="ltr" />
          </Field>
          <Field label={t('business.newBusiness.ownerPassword')} hint={t('business.newBusiness.ownerPasswordHint')}>
            <TextInput type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        {create.error && <Alert tone="error">{friendlyError(create.error)}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : null} {t('business.newBusiness.create')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Platform admins only: every business on Hotzonex Cloud. */
export function BusinessesPage() {
  const { t } = useT();
  const { business, twoStep, support, reload } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const manage = useMutation({
    mutationFn: async (b: BusinessRow) => {
      const { error } = await supabase.rpc('platform_support_start', { p_tenant_id: b.id, p_minutes: 120 });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: async () => {
      await reload();
      navigate('/routers');
    },
  });
  const list = useQuery({
    queryKey: ['businesses'],
    enabled: twoStep,
    queryFn: async (): Promise<BusinessRow[]> => {
      const { data, error } = await supabase.rpc('platform_tenants');
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggle = useMutation({
    mutationFn: async (b: BusinessRow) => {
      if (b.is_active && !window.confirm(t('business.businesses.confirmOff', { name: b.name }))) return;
      const { error } = await supabase.rpc('platform_set_tenant_active', { p_tenant_id: b.id, p_active: !b.is_active });
      if (error) throw error;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['businesses'] }),
  });

  const [removing, setRemoving] = useState<string | null>(null);
  const [removed, setRemoved] = useState<RemovedBusiness | null>(null);
  const startRemove = (b: BusinessRow) => {
    setRemoved(null);
    setRemoving(removing === b.id ? null : b.id);
  };

  if (!twoStep)
    return (
      <div className="space-y-4">
        <PageHeader title={t('nav.businesses')} subtitle={t('business.businesses.subtitle')} />
        <Alert tone="warning">
          {t('business.businesses.locked')}{' '}
          <Link to="/security" className="font-semibold underline">
            {t('business.businesses.lockedLink')}
          </Link>
          {t('business.businesses.lockedAfter')}
        </Alert>
      </div>
    );

  return (
    <div className="space-y-4">
      {manage.error && <Alert tone="error">{friendlyError(manage.error)}</Alert>}
      <PageHeader
        title={t('nav.businesses')}
        subtitle={t('business.businesses.subtitleFull')}
        actions={
          !adding && (
            <Button onClick={() => setAdding(true)} className="min-h-11">
              {t('business.businesses.add')}
            </Button>
          )
        }
      />

      {adding && <NewBusiness onClose={() => setAdding(false)} />}
      {list.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
      {list.error && <Alert tone="error">{friendlyError(list.error)}</Alert>}
      {toggle.error && <Alert tone="error">{friendlyError(toggle.error)}</Alert>}
      {removed && <Alert tone="success">{t('business.businesses.removed', { name: removed.removed, n: formatNumber(removed.users_removed) })}</Alert>}

      <div className="grid gap-3 md:grid-cols-2">
        {(list.data ?? []).map((b) => (
          <Card key={b.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className={`min-w-0 flex-1 ${b.is_active ? '' : 'opacity-60'}`}>
                <div className="truncate font-bold">
                  {b.name} {b.id === business?.id && <span className="font-normal text-slate-500">{t('business.businesses.yours')}</span>}
                </div>
                <div className="truncate text-sm text-slate-600">{b.admin_names ? t('business.businesses.owner', { names: b.admin_names }) : t('business.businesses.noOwner')}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge color="gray">{t('business.businesses.sites', { n: formatNumber(b.sites) })}</Badge>
                  <Badge color="gray">{t('business.businesses.routers', { n: formatNumber(b.routers) })}</Badge>
                  <Badge color="gray">{t('business.businesses.staff', { n: formatNumber(b.staff) })}</Badge>
                  <Badge color="blue">{b.timezone}</Badge>
                  {!b.is_active && <Badge color="red">{t('business.businesses.switchedOff')}</Badge>}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {(b.id !== business?.id || support) && b.id !== support?.tenant_id && (
                  <Button variant="secondary" disabled={manage.isPending} onClick={() => manage.mutate(b)} title={t('business.businesses.manageTitle')}>
                    {t('business.businesses.manage')}
                  </Button>
                )}
                {b.id !== business?.id && (
                  <Button variant={b.is_active ? 'danger' : 'secondary'} disabled={toggle.isPending} onClick={() => toggle.mutate(b)}>
                    {b.is_active ? t('business.businesses.switchOff') : t('business.businesses.switchOn')}
                  </Button>
                )}
                {b.id !== business?.id && !b.is_active && (
                  <Button variant="danger" aria-expanded={removing === b.id} onClick={() => startRemove(b)}>
                    {t('business.businesses.remove')}
                  </Button>
                )}
              </div>
            </div>
            {removing === b.id && (
              <div className="mt-3">
                <RemoveBusiness
                  id={b.id}
                  name={b.name}
                  active={b.is_active}
                  onClose={() => setRemoving(null)}
                  onRemoved={(r) => {
                    setRemoving(null);
                    setRemoved(r);
                  }}
                />
              </div>
            )}
          </Card>
        ))}
      </div>
      <PlatformBilling />
      <WhatsAppSender />
      <BillingMessages />
    </div>
  );
}
