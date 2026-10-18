import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { friendlyError } from '../lib/errors';
import { useT } from '../i18n';
import { translate } from '../i18n/translate';
import { formatNumber, formatSSP } from '../lib/format';
import { fromJson, supabase } from '../lib/supabase';
import { validate } from '../lib/validation';
import { Alert, Badge, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from './ui';

/** What a subscription plan allows; null = no limit. */
interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  price_per_router_ssp: number | null;
  max_routers: number | null;
  max_sites: number | null;
  max_staff: number | null;
  max_vouchers_month: number | null;
  is_public: boolean;
}

interface PlatformPlans {
  plans: SubscriptionPlan[];
  businesses: { tenant_id: string; plan_id: string; exempt: boolean; vouchers_month: number }[];
}

const PLANS_KEY = ['platform-plans'];

/** Platform owner: every plan and each business's plan. */
function usePlatformPlans() {
  return useQuery({
    queryKey: PLANS_KEY,
    queryFn: async (): Promise<PlatformPlans> => {
      const { data, error } = await supabase.rpc('platform_plans');
      if (error) throw new Error(friendlyError(error));
      return fromJson<PlatformPlans>(data);
    },
  });
}

/** "1 router · 1 site · 3 staff · 5,000 vouchers a month" */
function planSummary(p: Pick<SubscriptionPlan, 'max_routers' | 'max_sites' | 'max_staff' | 'max_vouchers_month'>): string {
  return [
    p.max_routers === null
      ? translate('business.limits.unlimitedRouters')
      : translate(p.max_routers === 1 ? 'business.limits.router' : 'business.limits.routers', { n: formatNumber(p.max_routers) }),
    p.max_sites === null
      ? translate('business.limits.unlimitedSites')
      : translate(p.max_sites === 1 ? 'business.limits.site' : 'business.limits.sites', { n: formatNumber(p.max_sites) }),
    p.max_staff === null ? translate('business.limits.unlimitedStaff') : translate('business.limits.staff', { n: formatNumber(p.max_staff) }),
    p.max_vouchers_month === null
      ? translate('business.limits.unlimitedVouchers')
      : translate('business.limits.vouchersMonth', { n: formatNumber(p.max_vouchers_month) }),
  ].join(' · ');
}

// -------------------------------------------------------------------------------------------
// Platform owner
// -------------------------------------------------------------------------------------------

const limit = () =>
  z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), translate('business.limits.errLimit'));

const planFormSchema = () =>
  z.object({
    id: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, translate('business.limits.errCode')),
    name: z.string().trim().min(1, translate('business.limits.errName')).max(40, translate('business.limits.errNameLong')),
    description: z.string().trim().max(300, translate('business.limits.errDescLong')),
    price: limit(),
    max_routers: limit(),
    max_sites: limit(),
    max_staff: limit(),
    max_vouchers_month: limit(),
    is_public: z.boolean(),
  });

type PlanForm = { id: string; name: string; description: string; price: string; max_routers: string; max_sites: string; max_staff: string; max_vouchers_month: string; is_public: boolean };

const toForm = (p: SubscriptionPlan | null): PlanForm => ({
  id: p?.id ?? '',
  name: p?.name ?? '',
  description: p?.description ?? '',
  price: p?.price_per_router_ssp == null ? '' : String(p.price_per_router_ssp),
  max_routers: p?.max_routers == null ? '' : String(p.max_routers),
  max_sites: p?.max_sites == null ? '' : String(p.max_sites),
  max_staff: p?.max_staff == null ? '' : String(p.max_staff),
  max_vouchers_month: p?.max_vouchers_month == null ? '' : String(p.max_vouchers_month),
  is_public: p?.is_public ?? true,
});

function PlanEditor({ plan, stdPrice, onDone }: { plan: SubscriptionPlan | null; stdPrice: number; onDone: () => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlanForm>(() => toForm(plan));
  const set = (k: keyof PlanForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: async () => {
      const v = validate(planFormSchema(), form);
      const { error } = await supabase.rpc('platform_save_plan', {
        p_id: v.id,
        p_name: v.name,
        p_description: v.description,
        p_price_per_router_ssp: v.price,
        p_max_routers: v.max_routers,
        p_max_sites: v.max_sites,
        p_max_staff: v.max_staff,
        p_max_vouchers_month: v.max_vouchers_month,
        p_is_public: v.is_public,
      });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PLANS_KEY });
      onDone();
    },
  });
  const num = (k: keyof PlanForm, label: string, hint?: string) => (
    <Field label={label} hint={hint ?? t('business.limits.emptyNoLimit')}>
      <TextInput inputMode="numeric" value={String(form[k])} onChange={set(k)} />
    </Field>
  );
  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('business.limits.code')} hint={t('business.limits.codeHint')}>
          <TextInput value={form.id} onChange={set('id')} disabled={plan !== null} dir="ltr" />
        </Field>
        <Field label={t('business.limits.name')}>
          <TextInput value={form.name} onChange={set('name')} />
        </Field>
      </div>
      <Field label={t('business.limits.description')}>
        <TextInput value={form.description} onChange={set('description')} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {num('price', t('business.limits.price'), t('business.limits.emptyStandard', { price: formatSSP(stdPrice) }))}
        {num('max_routers', t('business.limits.routersField'))}
        {num('max_sites', t('business.limits.sitesField'))}
        {num('max_staff', t('business.limits.staffField'))}
        {num('max_vouchers_month', t('business.limits.vouchersField'))}
      </div>
      <Checkbox label={t('business.limits.public')} checked={form.is_public} onChange={(v) => setForm((f) => ({ ...f, is_public: v }))} />
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Spinner />} {t('business.limits.savePlan')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Platform owner: the plans businesses can be on, with their limits and prices. */
export function PlansCard({ stdPrice }: { stdPrice: number }) {
  const { t } = useT();
  const plans = usePlatformPlans();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  if (plans.error) return <Alert tone="error">{friendlyError(plans.error)}</Alert>;
  if (!plans.data) return <Spinner />;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{t('business.limits.title')}</h2>
          <p className="text-sm text-slate-600">{t('business.limits.text')}</p>
        </div>
        {editing === null && (
          <Button variant="secondary" onClick={() => setEditing('new')}>
            {t('business.limits.newPlan')}
          </Button>
        )}
      </div>
      {editing === 'new' && <PlanEditor plan={null} stdPrice={stdPrice} onDone={() => setEditing(null)} />}
      {plans.data.plans.length === 0 && editing !== 'new' && <p className="text-sm text-slate-600">{t('business.limits.noPlans')}</p>}
      <ul className="divide-y divide-slate-100">
        {plans.data.plans.map((p) => (
          <li key={p.id} className="space-y-2 py-3">
            {editing === p.id ? (
              <PlanEditor plan={p} stdPrice={stdPrice} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">
                    {p.name} <span className="text-sm font-normal text-slate-600">({p.id})</span> {!p.is_public && <Badge color="gray">{t('business.limits.hidden')}</Badge>}
                  </p>
                  <p className="text-sm text-slate-600">{planSummary(p)}</p>
                  <p className="text-sm text-slate-600">
                    {t('business.limits.perRouter', { price: formatSSP(p.price_per_router_ssp ?? stdPrice) })}
                    {p.price_per_router_ssp === null ? t('business.limits.standardPrice') : ''}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setEditing(p.id)}>
                  {t('common.edit')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Platform owner: a business's plan (changed at once), its voucher use this month, and trial shortcuts. */
export function BusinessPlanControl({ tenantId, onExtendTrial }: { tenantId: string; onExtendTrial: (days: number) => void }) {
  const { t } = useT();
  const plans = usePlatformPlans();
  const queryClient = useQueryClient();
  const row = plans.data?.businesses.find((b) => b.tenant_id === tenantId);
  const [planId, setPlanId] = useState(row?.plan_id ?? '');
  useEffect(() => setPlanId(row?.plan_id ?? ''), [row?.plan_id]);
  const change = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('platform_set_business_plan', { p_tenant_id: tenantId, p_plan_id: id });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLANS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['platform-billing'] });
    },
    // Show the plan that is really saved, not the one that failed.
    onError: () => setPlanId(row?.plan_id ?? ''),
  });
  if (!plans.data || !row) return null;
  const plan = plans.data.plans.find((p) => p.id === row.plan_id);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-48">
        <Field label={t('common.plan')}>
          <Select
            value={planId}
            onChange={(e) => {
              setPlanId(e.target.value);
              change.mutate(e.target.value);
            }}
            disabled={change.isPending}
          >
            {plans.data.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <span className="pb-3 text-sm text-slate-600">
        {t('business.limits.vouchersThisMonth', {
          n: `${formatNumber(row.vouchers_month)}${plan?.max_vouchers_month != null ? ` / ${formatNumber(plan.max_vouchers_month)}` : ''}`,
        })}
      </span>
      <Button variant="secondary" onClick={() => onExtendTrial(14)}>
        {t('business.limits.trialPlus', { n: 14 })}
      </Button>
      <Button variant="secondary" onClick={() => onExtendTrial(30)}>
        {t('business.limits.trialPlus', { n: 30 })}
      </Button>
      {change.error && <Alert tone="error">{friendlyError(change.error)}</Alert>}
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Business owner
// -------------------------------------------------------------------------------------------

interface Usage {
  plan: Pick<SubscriptionPlan, 'id' | 'name' | 'description' | 'max_routers' | 'max_sites' | 'max_staff' | 'max_vouchers_month'>;
  limited: boolean;
  usage: { routers: number; sites: number; staff: number; vouchers_month: number };
}

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const { t } = useT();
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const tone = max === null ? 'bg-emerald-500' : pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600';
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-900">
          {formatNumber(used)} / {max === null ? t('business.limits.noLimit') : formatNumber(max)}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemax={max ?? undefined}>
        <div className={`h-full ${tone}`} style={{ width: max === null ? '100%' : `${pct}%` }} />
      </div>
    </div>
  );
}

/** Business owner: the plan and how much of it is used. */
export function OwnerPlanUsage() {
  const { t } = useT();
  const usage = useQuery({
    queryKey: ['billing-usage'],
    staleTime: 60_000,
    queryFn: async (): Promise<Usage> => {
      const { data, error } = await supabase.rpc('billing_usage');
      if (error) throw new Error(friendlyError(error));
      return fromJson<Usage>(data);
    },
  });
  if (usage.error) return <Alert tone="error">{friendlyError(usage.error)}</Alert>;
  const u = usage.data;
  if (!u) return null;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{t('business.limits.yourPlan', { name: u.plan.name })}</h2>
        {!u.limited && <Badge color="green">{t('business.limits.noLimits')}</Badge>}
      </div>
      {u.plan.description && <p className="text-slate-700">{u.plan.description}</p>}
      {u.limited && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Meter label={t('business.limits.routersField')} used={u.usage.routers} max={u.plan.max_routers} />
          <Meter label={t('business.limits.sitesField')} used={u.usage.sites} max={u.plan.max_sites} />
          <Meter label={t('business.limits.meterStaff')} used={u.usage.staff} max={u.plan.max_staff} />
          <Meter label={t('business.limits.meterVouchers')} used={u.usage.vouchers_month} max={u.plan.max_vouchers_month} />
        </div>
      )}
      {u.limited && <p className="text-sm text-slate-600">{t('business.limits.needMore')}</p>}
    </Card>
  );
}
