import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlatformBilling } from '../../components/PlatformBilling';
import { WhatsAppSender } from '../../components/WhatsAppSender';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Field, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
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
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BusinessForm>(NEW_FORM);
  const set = <K extends keyof BusinessForm>(key: K, value: BusinessForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const create = useMutation({
    mutationFn: async () => {
      if (!form.business_name.trim()) throw new Error('Enter the business name.');
      if (!form.full_name.trim() || !form.email.trim()) throw new Error("Enter the business admin's name and email.");
      if (form.password.length < 8) throw new Error('The password must be at least 8 characters.');
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
      <h2 className="mb-1 text-lg font-bold">Add a business</h2>
      <p className="mb-4 text-sm text-slate-600">
        The business gets its own sites, plans, routers, staff and sales. Its admin logs in with the email and password below and adds the rest.
      </p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name">
            <TextInput value={form.business_name} onChange={(e) => set('business_name', e.target.value)} maxLength={100} />
          </Field>
          <Field label="First site" hint="For example the town or shop name. Default: Main site">
            <TextInput value={form.site_name} onChange={(e) => set('site_name', e.target.value)} maxLength={80} />
          </Field>
          <Field label="Time zone" hint="Reports count days in this time zone">
            <TextInput value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Africa/Juba" />
          </Field>
          <Field label="Owner's full name">
            <TextInput value={form.full_name} onChange={(e) => set('full_name', e.target.value)} maxLength={80} />
          </Field>
          <Field label="Owner's email (login)">
            <TextInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Owner's first password" hint="At least 8 characters; they can change it later">
            <TextInput type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        {create.error && <Alert tone="error">{create.error.message}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : null} Create business
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Platform admins only: every business on Hotzonex Cloud. */
export function BusinessesPage() {
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
      if (b.is_active && !window.confirm(`Switch off ${b.name}? Its staff can no longer log in until you switch it back on. Nothing is deleted.`)) return;
      const { error } = await supabase.rpc('platform_set_tenant_active', { p_tenant_id: b.id, p_active: !b.is_active });
      if (error) throw error;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['businesses'] }),
  });

  if (!twoStep)
    return (
      <div className="space-y-4">
        <PageHeader title="Businesses" subtitle="Every hotspot business on Hotzonex Cloud" />
        <Alert tone="warning">
          Platform controls (all businesses, support mode, billing) open only after logging in with your 2-step code.{' '}
          <Link to="/security" className="font-semibold underline">
            Turn on the 2-step login
          </Link>
          , then log out and in again.
        </Alert>
      </div>
    );

  return (
    <div className="space-y-4">
      {manage.error && <Alert tone="error">{friendlyError(manage.error)}</Alert>}
      <PageHeader
        title="Businesses"
        subtitle="Every hotspot business on Hotzonex Cloud. Each one sees only its own data."
        actions={
          !adding && (
            <Button onClick={() => setAdding(true)} className="min-h-11">
              + Add business
            </Button>
          )
        }
      />

      {adding && <NewBusiness onClose={() => setAdding(false)} />}
      {list.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
      {list.error && <Alert tone="error">{friendlyError(list.error)}</Alert>}
      {toggle.error && <Alert tone="error">{friendlyError(toggle.error)}</Alert>}

      <div className="grid gap-3 md:grid-cols-2">
        {(list.data ?? []).map((b) => (
          <Card key={b.id} className={b.is_active ? '' : 'opacity-60'}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-bold">
                  {b.name} {b.id === business?.id && <span className="font-normal text-slate-500">(yours)</span>}
                </div>
                <div className="truncate text-sm text-slate-600">{b.admin_names ? `Owner: ${b.admin_names}` : 'No owner yet'}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge color="gray">{formatNumber(b.sites)} sites</Badge>
                  <Badge color="gray">{formatNumber(b.routers)} routers</Badge>
                  <Badge color="gray">{formatNumber(b.staff)} staff</Badge>
                  <Badge color="blue">{b.timezone}</Badge>
                  {!b.is_active && <Badge color="red">Switched off</Badge>}
                </div>
              </div>
              {(b.id !== business?.id || support) && b.id !== support?.tenant_id && (
                <Button variant="secondary" disabled={manage.isPending} onClick={() => manage.mutate(b)} title="Manage this business's routers and settings for 2 hours (support mode)">
                  Manage
                </Button>
              )}
              {b.id !== business?.id && (
                <Button variant={b.is_active ? 'danger' : 'secondary'} disabled={toggle.isPending} onClick={() => toggle.mutate(b)}>
                  {b.is_active ? 'Switch off' : 'Switch on'}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <PlatformBilling />
      <WhatsAppSender />
    </div>
  );
}
