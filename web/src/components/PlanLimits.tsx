import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { friendlyError } from '../lib/errors';
import { formatNumber } from '../lib/format';
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

const NEEDS_UPDATE = 'Plans need the database update of 16 October (migration 20261016190000).';
const PLANS_KEY = ['platform-plans'];

/** Platform owner: every plan and each business's plan (null while the migration is not applied). */
function usePlatformPlans() {
  return useQuery({
    queryKey: PLANS_KEY,
    queryFn: async (): Promise<PlatformPlans | null> => {
      const { data, error } = await supabase.rpc('platform_plans');
      if (error?.code === 'PGRST202') return null;
      if (error) throw new Error(friendlyError(error));
      return fromJson<PlatformPlans>(data);
    },
  });
}

const limitText = (n: number | null, unit: string) => (n === null ? `Unlimited ${unit}` : `${formatNumber(n)} ${unit}`);

/** "1 router · 1 site · 3 staff · 5,000 vouchers a month" */
function planSummary(p: Pick<SubscriptionPlan, 'max_routers' | 'max_sites' | 'max_staff' | 'max_vouchers_month'>): string {
  return [
    limitText(p.max_routers, p.max_routers === 1 ? 'router' : 'routers'),
    limitText(p.max_sites, p.max_sites === 1 ? 'site' : 'sites'),
    limitText(p.max_staff, 'staff'),
    p.max_vouchers_month === null ? 'unlimited vouchers' : `${formatNumber(p.max_vouchers_month)} vouchers a month`,
  ].join(' · ');
}

// -------------------------------------------------------------------------------------------
// Platform owner
// -------------------------------------------------------------------------------------------

const limit = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : Number(v)))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0), 'Limits are whole numbers (empty = no limit).');

const planFormSchema = z.object({
  id: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, 'The plan code is 2 to 30 small letters, digits or dashes (e.g. starter).'),
  name: z.string().trim().min(1, 'Type the plan name.').max(40, 'The plan name is too long (max 40 characters).'),
  description: z.string().trim().max(300, 'The description is too long (max 300 characters).'),
  price: limit,
  max_routers: limit,
  max_sites: limit,
  max_staff: limit,
  max_vouchers_month: limit,
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
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlanForm>(() => toForm(plan));
  const set = (k: keyof PlanForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: async () => {
      const v = validate(planFormSchema, form);
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
    <Field label={label} hint={hint ?? 'Empty = no limit'}>
      <TextInput inputMode="numeric" value={String(form[k])} onChange={set(k)} />
    </Field>
  );
  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Plan code" hint="Never changes once used, e.g. starter">
          <TextInput value={form.id} onChange={set('id')} disabled={plan !== null} />
        </Field>
        <Field label="Name">
          <TextInput value={form.name} onChange={set('name')} />
        </Field>
      </div>
      <Field label="Description (shown on the landing page)">
        <TextInput value={form.description} onChange={set('description')} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {num('price', 'Price / router / month (SSP)', `Empty: standard ${formatNumber(stdPrice)}`)}
        {num('max_routers', 'Routers')}
        {num('max_sites', 'Sites')}
        {num('max_staff', 'Staff logins')}
        {num('max_vouchers_month', 'Vouchers a month')}
      </div>
      <Checkbox label="Show on the landing page" checked={form.is_public} onChange={(v) => setForm((f) => ({ ...f, is_public: v }))} />
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Spinner />} Save plan
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Platform owner: the plans businesses can be on, with their limits and prices. */
export function PlansCard({ stdPrice }: { stdPrice: number }) {
  const plans = usePlatformPlans();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  if (plans.isLoading) return <Spinner />;
  if (plans.error) return <Alert tone="error">{friendlyError(plans.error)}</Alert>;
  if (!plans.data) return <Alert tone="warning">{NEEDS_UPDATE}</Alert>;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Subscription plans</h2>
          <p className="text-sm text-slate-600">Limits are enforced by the database. Businesses that are not billed have no limits.</p>
        </div>
        {editing === null && (
          <Button variant="secondary" onClick={() => setEditing('new')}>
            + New plan
          </Button>
        )}
      </div>
      {editing === 'new' && <PlanEditor plan={null} stdPrice={stdPrice} onDone={() => setEditing(null)} />}
      <ul className="divide-y divide-slate-100">
        {plans.data.plans.map((p) => (
          <li key={p.id} className="space-y-2 py-3">
            {editing === p.id ? (
              <PlanEditor plan={p} stdPrice={stdPrice} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">
                    {p.name} <span className="text-sm font-normal text-slate-600">({p.id})</span> {!p.is_public && <Badge color="gray">Hidden</Badge>}
                  </p>
                  <p className="text-sm text-slate-600">{planSummary(p)}</p>
                  <p className="text-sm text-slate-600">
                    {formatNumber(p.price_per_router_ssp ?? stdPrice)} SSP per router per month{p.price_per_router_ssp === null ? ' (standard price)' : ''}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setEditing(p.id)}>
                  Edit
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
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: PLANS_KEY }),
  });
  if (!plans.data || !row) return null;
  const plan = plans.data.plans.find((p) => p.id === row.plan_id);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-48">
        <Field label="Plan">
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
        {formatNumber(row.vouchers_month)}
        {plan?.max_vouchers_month != null ? ` / ${formatNumber(plan.max_vouchers_month)}` : ''} vouchers this month
      </span>
      <Button variant="secondary" onClick={() => onExtendTrial(14)}>
        Trial +14 days
      </Button>
      <Button variant="secondary" onClick={() => onExtendTrial(30)}>
        Trial +30 days
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
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const tone = max === null ? 'bg-emerald-500' : pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600';
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-900">
          {formatNumber(used)} / {max === null ? 'no limit' : formatNumber(max)}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemax={max ?? undefined}>
        <div className={`h-full ${tone}`} style={{ width: max === null ? '100%' : `${pct}%` }} />
      </div>
    </div>
  );
}

/** Business owner: the plan and how much of it is used (hidden until the migration is applied). */
export function OwnerPlanUsage() {
  const usage = useQuery({
    queryKey: ['billing-usage'],
    staleTime: 60_000,
    queryFn: async (): Promise<Usage | null> => {
      const { data, error } = await supabase.rpc('billing_usage');
      if (error?.code === 'PGRST202') return null;
      if (error) throw new Error(friendlyError(error));
      return data as Usage | null;
    },
  });
  const u = usage.data;
  if (!u) return null;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Your plan: {u.plan.name}</h2>
        {!u.limited && <Badge color="green">No limits</Badge>}
      </div>
      {u.plan.description && <p className="text-slate-700">{u.plan.description}</p>}
      {u.limited && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Meter label="Routers" used={u.usage.routers} max={u.plan.max_routers} />
          <Meter label="Sites" used={u.usage.sites} max={u.plan.max_sites} />
          <Meter label="Active staff logins" used={u.usage.staff} max={u.plan.max_staff} />
          <Meter label="Vouchers made this month" used={u.usage.vouchers_month} max={u.plan.max_vouchers_month} />
        </div>
      )}
      {u.limited && <p className="text-sm text-slate-600">Need more? Contact Hotzonex Cloud to move to a bigger plan.</p>}
    </Card>
  );
}
