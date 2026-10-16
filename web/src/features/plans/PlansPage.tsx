import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatDuration, formatSSP } from '../../lib/format';
import { invokeFunction } from '../../lib/functions';
import { RouterTimeoutError, waitForJob } from '../../lib/jobs';
import { profileLabel } from '../../lib/mikroticket';
import { usePlans, useRouters } from '../../hooks/queries';
import { supabase } from '../../lib/supabase';
import type { Plan, RouterInfo } from '../../lib/types';
import { planSchema, validate } from '../../lib/validation';

const SWATCHES = ['#16a34a', '#2563eb', '#dc2626', '#f59e0b', '#7c3aed', '#db2777', '#0891b2', '#475569'];

type TimeUnit = 'minutes' | 'hours' | 'days';
const UNIT_SECONDS: Record<TimeUnit, number> = { minutes: 60, hours: 3600, days: 86400 };

/** Picks the largest unit that divides the seconds evenly, for editing. */
function splitDuration(seconds: number): { amount: string; unit: TimeUnit } {
  if (seconds % 86400 === 0) return { amount: String(seconds / 86400), unit: 'days' };
  if (seconds % 3600 === 0) return { amount: String(seconds / 3600), unit: 'hours' };
  return { amount: String(Math.round(seconds / 60)), unit: 'minutes' };
}

/** MikroTicket's label and price in a profile name: the same plan on routers whose profiles differ in the rest. */
/**
 * The router profile Hotzonex makes for a plan: "hzc-<name>-<price>". It never takes the name of a
 * MikroTicket profile ("profile_…"), so Hotzonex and MikroTicket profiles stay apart on the router.
 */
/** The profile a newly ticked router gets: the plan's own hzc- profile, or a new one for older plans. */
function linkProfileName(plan: Plan | null, generated: string): string {
  return plan?.router_profile_name.startsWith('hzc-') ? plan.router_profile_name : generated;
}

function hotzonexProfileName(name: string, priceSsp: number): string {
  const label = name.replace(/[^A-Za-z0-9._]/g, '').slice(0, 40) || 'Plan';
  return `hzc-${label}-${priceSsp}`;
}

/** A plan made from a MikroTicket profile before 16 October 2026 (now switched off, kept for reports). */
const isMikroticketPlan = (p: Plan) => p.router_profile_name.startsWith('profile_') && !(p.plan_routers ?? []).some((l) => l.managed);

interface PlanForm {
  id: string | null;
  name: string;
  price: string;
  uptimeAmount: string;
  uptimeUnit: TimeUnit;
  hasValidity: boolean;
  validityAmount: string;
  validityUnit: TimeUnit;
  rateLimit: string;
  dataLimitMb: string;
  sharedUsers: string;
  color: string;
  isActive: boolean;
  /** Routers ticked to carry the plan. */
  routerIds: string[];
}

function newPlan(routers: RouterInfo[]): PlanForm {
  return {
    id: null,
    name: '',
    price: '',
    uptimeAmount: '2',
    uptimeUnit: 'hours',
    hasValidity: true,
    validityAmount: '1',
    validityUnit: 'days',
    rateLimit: '2M/2M',
    dataLimitMb: '',
    sharedUsers: '1',
    color: SWATCHES[0] ?? '#16a34a',
    isActive: true,
    routerIds: routers.map((r) => r.id),
  };
}

function toForm(p: Plan): PlanForm {
  const up = splitDuration(p.uptime_seconds);
  const val = splitDuration(p.validity_seconds ?? 86400);
  return {
    id: p.id,
    name: p.name,
    price: String(p.price_ssp),
    uptimeAmount: up.amount,
    uptimeUnit: up.unit,
    hasValidity: p.validity_seconds !== null,
    validityAmount: val.amount,
    validityUnit: val.unit,
    rateLimit: p.rate_limit ?? '',
    dataLimitMb: p.data_limit_mb ? String(p.data_limit_mb) : '',
    sharedUsers: String(p.shared_users),
    color: p.color,
    isActive: p.is_active,
    routerIds: (p.plan_routers ?? []).map((l) => l.router_id),
  };
}

const wholeNumber = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);

function PlanEditor({
  initial,
  plan,
  routers,
  onClose,
}: {
  initial: PlanForm;
  /** The plan being edited (null for a new one). */
  plan: Plan | null;
  routers: RouterInfo[];
  onClose: (saved: boolean, message?: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlanForm>(initial);
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const linkOf = (routerId: string) => plan?.plan_routers.find((l) => l.router_id === routerId) ?? null;

  // The editor opens at the top of the page: bring it into view (Edit is often pressed far below it).
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    top.current?.querySelector('input')?.focus({ preventScroll: true });
  }, []);

  const toggleRouter = (id: string) =>
    setForm((f) => ({ ...f, routerIds: f.routerIds.includes(id) ? f.routerIds.filter((r) => r !== id) : [...f.routerIds, id] }));

  /** What a router uses for this plan: the profile Hotzonex makes (older plans may use the router's own). */
  function routerNote(r: RouterInfo): string {
    const link = linkOf(r.id);
    if (link) return link.managed ? 'profile made by Hotzonex' : `uses its own profile ${profileLabel(link.profile_name)}`;
    return r.status === 'pending' ? 'profile is made once the router is connected' : 'Hotzonex makes the profile';
  }

  const save = useMutation({
    mutationFn: async () => {
      const checked = validate(planSchema, {
        name: form.name,
        price_ssp: wholeNumber(form.price),
        uptime_seconds: wholeNumber(form.uptimeAmount) * UNIT_SECONDS[form.uptimeUnit],
        validity_seconds: form.hasValidity ? wholeNumber(form.validityAmount) * UNIT_SECONDS[form.validityUnit] : null,
        rate_limit: form.rateLimit,
        data_limit_mb: form.dataLimitMb.trim() ? wholeNumber(form.dataLimitMb.trim()) : null,
        shared_users: wholeNumber(form.sharedUsers),
        router_ids: form.routerIds,
      });
      const { name, price_ssp: price, uptime_seconds: uptime, validity_seconds: validity, data_limit_mb: data, shared_users: shared } = checked;
      const rate = checked.rate_limit;

      const values = { name, price_ssp: price, uptime_seconds: uptime, validity_seconds: validity };
      const generated = hotzonexProfileName(name, price);
      const row = { ...values, rate_limit: rate || null, data_limit_mb: data, shared_users: shared, color: form.color, is_active: form.isActive };

      let planId = form.id;
      if (planId) {
        const { error } = await supabase.from('plans').update(row).eq('id', planId);
        if (error) throw error;
      } else {
        const { data: created, error } = await supabase.from('plans').insert({ ...row, router_profile_name: generated }).select('id').single();
        if (error) throw error;
        planId = created.id as string;
      }

      // Routers ticked now get the plan with the profile Hotzonex makes (never a MikroTicket profile).
      // Routers unticked lose it (the profile goes from the router too, unless users are on it).
      const linked = new Set((plan?.plan_routers ?? []).map((l) => l.router_id));
      const added = routers
        .filter((r) => form.routerIds.includes(r.id) && !linked.has(r.id))
        .map((r) => ({ plan_id: planId, router_id: r.id, profile_name: linkProfileName(plan, generated), managed: true }));
      const removed = [...linked].filter((id) => !form.routerIds.includes(id));
      if (added.length) {
        // A router profile removed from Hotzonex earlier is back in use.
        for (const a of added.filter((x) => !x.managed)) {
          await supabase.from('router_profile_ignores').delete().eq('router_id', a.router_id).eq('profile_name', a.profile_name);
        }
        const { error } = await supabase.from('plan_routers').insert(added);
        if (error) throw error;
      }
      if (removed.length) {
        // The router's own profiles (MikroTicket's) stay on the router; Hotzonex stops making a plan of them.
        const keep = (plan?.plan_routers ?? []).filter((l) => removed.includes(l.router_id) && !l.managed).map((l) => ({ router_id: l.router_id, profile_name: l.profile_name }));
        if (keep.length) {
          const { error } = await supabase.from('router_profile_ignores').upsert(keep, { onConflict: 'router_id,profile_name', ignoreDuplicates: true });
          if (error) throw error;
        }
        const { error } = await supabase.from('plan_routers').delete().eq('plan_id', planId).in('router_id', removed);
        if (error) throw error;
      }

      const made = added.filter((a) => a.managed).length;
      const own = added.length - made;
      const parts = [`${name} saved.`];
      if (made) parts.push(`Its profile is being added to ${made} router${made === 1 ? '' : 's'}.`);
      if (own) parts.push(`${own} router${own === 1 ? '' : 's'} use${own === 1 ? 's' : ''} its own matching profile as it is.`);
      const removedMade = (plan?.plan_routers ?? []).filter((l) => removed.includes(l.router_id) && l.managed).length;
      if (removedMade) parts.push(`Its profile is being removed from ${removedMade} router${removedMade === 1 ? '' : 's'} (kept there while users are on it).`);
      if (removed.length > removedMade) parts.push(`No longer sold on ${removed.length - removedMade} router${removed.length - removedMade === 1 ? '' : 's'}; their own profile stays on the router.`);
      if (plan && !added.length && (plan.plan_routers ?? []).some((l) => l.managed)) parts.push('Profiles made by Hotzonex are updated on the routers within a minute.');
      return parts.join(' ');
    },
    onSuccess: (message) => {
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      onClose(true, message);
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: ['plans'] }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const ownOnRouters = (plan?.plan_routers ?? []).filter((l) => !l.managed && form.routerIds.includes(l.router_id));

  return (
    <div ref={top} className="scroll-mt-20">
      <Card>
        <h2 className="mb-1 text-lg font-bold">{form.id ? `Edit ${initial.name}` : 'New plan'}</h2>
        <p className="mb-4 text-sm text-slate-600">
          Set the plan and tick the routers that sell it. Hotzonex makes its own user profile on those routers (named hzc-…), separate from
          MikroTicket's profiles.
        </p>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan name">
              <TextInput value={form.name} maxLength={40} placeholder="2Hrs" onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Price (SSP)">
              <TextInput inputMode="numeric" value={form.price} onChange={(e) => set('price', e.target.value.replace(/\D/g, ''))} placeholder="1500" />
            </Field>
            <Field label="Time allowed" hint="Total connected time (uptime limit on the router)">
              <div className="flex gap-2">
                <TextInput inputMode="numeric" value={form.uptimeAmount} onChange={(e) => set('uptimeAmount', e.target.value.replace(/\D/g, ''))} />
                <Select value={form.uptimeUnit} onChange={(e) => set('uptimeUnit', e.target.value as TimeUnit)}>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </Select>
              </div>
            </Field>
            <div>
              <Field label="Validity after first login" hint="The voucher expires this long after first use, even if time is left">
                <div className="flex gap-2">
                  <TextInput
                    inputMode="numeric"
                    value={form.hasValidity ? form.validityAmount : ''}
                    disabled={!form.hasValidity}
                    placeholder="no limit"
                    onChange={(e) => set('validityAmount', e.target.value.replace(/\D/g, ''))}
                  />
                  <Select value={form.validityUnit} disabled={!form.hasValidity} onChange={(e) => set('validityUnit', e.target.value as TimeUnit)}>
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </Select>
                </div>
              </Field>
              <Checkbox label="No validity limit" checked={!form.hasValidity} onChange={(v) => set('hasValidity', !v)} />
            </div>
            <Field label="Speed limit (upload/download)" hint="e.g. 2M/2M or 512k/1M. Empty = no limit">
              <TextInput value={form.rateLimit} onChange={(e) => set('rateLimit', e.target.value.replace(/\s/g, ''))} placeholder="2M/2M" />
            </Field>
            <Field label="Devices per code" hint="How many devices may use one code at the same time">
              <TextInput inputMode="numeric" value={form.sharedUsers} onChange={(e) => set('sharedUsers', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Data limit (MB)" hint="Empty = no data limit">
              <TextInput inputMode="numeric" value={form.dataLimitMb} onChange={(e) => set('dataLimitMb', e.target.value.replace(/\D/g, ''))} placeholder="none" />
            </Field>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Routers that sell this plan</span>
            {routers.length === 0 && <p className="text-sm text-slate-500">No routers yet. Add one on the Routers page.</p>}
            <div className="grid gap-1 sm:grid-cols-2">
              {routers.map((r) => (
                <label key={r.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
                  <input type="checkbox" className="mt-0.5 h-5 w-5" checked={form.routerIds.includes(r.id)} onChange={() => toggleRouter(r.id)} />
                  <span>
                    <span className="block font-medium text-slate-900">{r.name}</span>
                    {form.routerIds.includes(r.id) && <span className="block text-xs text-slate-500">{routerNote(r)}</span>}
                    {!form.routerIds.includes(r.id) && linkOf(r.id) && (
                      <span className="block text-xs text-amber-700">
                        {linkOf(r.id)?.managed
                          ? 'No longer sold here; the profile Hotzonex made is removed from this router (kept while users are on it)'
                          : 'No longer sold here; the router keeps its own profile'}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {ownOnRouters.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Routers using their own profile keep their own speed and devices per code; the values above apply to profiles Hotzonex makes.
              </p>
            )}
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-slate-700">Colour (cards and Sell buttons)</span>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  onClick={() => set('color', c)}
                  className={`h-11 w-11 rounded-xl ring-offset-2 ${form.color === c ? 'ring-2 ring-slate-900' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => set('color', e.target.value)}
                className="h-11 w-14 cursor-pointer rounded-xl border border-slate-300 bg-white p-1"
                aria-label="Custom colour"
              />
            </div>
          </div>

          <Checkbox label="Plan active (can be sold and generated)" checked={form.isActive} onChange={(v) => set('isActive', v)} />

          {save.error && <Alert tone="error">{friendlyPlanError(save.error)}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />} Save plan
            </Button>
            <Button variant="ghost" onClick={() => onClose(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function friendlyPlanError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === '23505') {
    if (e.message?.includes('router_profile_name') || e.message?.includes('plan_routers')) return 'A plan with the same name, price and time already exists on one of these routers.';
    return 'A plan with this name already exists. Choose another name.';
  }
  return err instanceof Error && !e.code ? err.message : friendlyError(err);
}

export function PlansPage() {
  const plans = usePlans();
  const routersQuery = useRouters();
  const routers = routersQuery.data ?? [];
  const [editing, setEditing] = useState<{ form: PlanForm; plan: Plan | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const routerName = (id: string) => routers.find((r) => r.id === id)?.name ?? 'Router';

  const remove = useMutation({
    mutationFn: async (p: Plan) => {
      const made = (p.plan_routers ?? []).some((l) => l.managed);
      const own = (p.plan_routers ?? []).some((l) => !l.managed);
      const what = [
        made ? 'The profile Hotzonex made is deleted from the routers too (kept while hotspot users are on it).' : '',
        own ? "Routers that use their own profile (e.g. MikroTicket's) keep it; it is just no longer a plan here." : '',
      ].filter(Boolean);
      if (!window.confirm(`Delete plan ${p.name}? ${what.join(' ')}`)) return null;
      const r = await invokeFunction<{ deleted?: boolean; removing?: number; kept_on_routers?: number; job_ids?: string[] }>('delete-items', { action: 'delete_plan', id: p.id });
      const kept = r.kept_on_routers ? ` The router${r.kept_on_routers === 1 ? '' : 's'} keep${r.kept_on_routers === 1 ? 's' : ''} its own profile.` : '';
      if (r.deleted) return `${p.name} deleted.${kept}`;
      // The routers delete the profile first; the plan goes once they have.
      try {
        const jobs = await Promise.all((r.job_ids ?? []).map((id) => waitForJob(id)));
        const failed = jobs.find((j) => j.status === 'failed');
        if (failed) throw new Error(String((failed.result as { error?: string } | null)?.error ?? 'The router could not delete the profile.'));
        return `${p.name} deleted, and its profile removed from the router.`;
      } catch (err) {
        if (err instanceof RouterTimeoutError) {
          return `${p.name} is switched off. Its profile is deleted from the router as soon as the router is reachable, then the plan disappears.`;
        }
        throw err;
      }
    },
    onSuccess: (text) => {
      if (text) setNotice(text);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['plans'] }),
  });

  // The old plans made from MikroTicket profiles stay out of the way (switched off, kept for reports).
  const oldMikroticket = (plans.data ?? []).filter((p) => isMikroticketPlan(p) && !p.is_active);
  const currentPlans = (plans.data ?? []).filter((p) => !oldMikroticket.includes(p));

  function open(form: PlanForm, plan: Plan | null) {
    setNotice(null);
    remove.reset();
    setEditing({ form, plan });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Plans"
        subtitle="A plan is what you sell: price, time and speed. Tick the routers that sell it and Hotzonex makes its own profile on them (MikroTicket's profiles are not used)."
        actions={!editing && <Button onClick={() => open(newPlan(routers), null)}>+ New plan</Button>}
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      {remove.error && <Alert tone="error">{remove.error.message}</Alert>}
      {editing && (
        <PlanEditor
          key={editing.plan?.id ?? 'new'}
          initial={editing.form}
          plan={editing.plan}
          routers={routers}
          onClose={(saved, message) => {
            setEditing(null);
            document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
            if (saved && message) setNotice(message);
          }}
        />
      )}

      {plans.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
      {plans.error && <Alert tone="error">{friendlyError(plans.error)}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {currentPlans.map((p) => (
          <Card key={p.id} className={`overflow-hidden !p-0 ${p.is_active ? '' : 'opacity-60'}`}>
            <div className="h-3" style={{ backgroundColor: p.color }} />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-bold">{p.name}</div>
                  <div className="text-2xl font-extrabold tabular-nums">{formatSSP(p.price_ssp)}</div>
                </div>
                {!p.is_active && <Badge color="gray">Off</Badge>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-slate-500">Time</dt>
                <dd className="font-medium">{formatDuration(p.uptime_seconds)}</dd>
                <dt className="text-slate-500">Validity</dt>
                <dd className="font-medium">{p.validity_seconds ? formatDuration(p.validity_seconds) : 'No limit'}</dd>
                <dt className="text-slate-500">Speed</dt>
                <dd className="font-medium">{p.rate_limit ?? 'No limit'}</dd>
                <dt className="text-slate-500">Data</dt>
                <dd className="font-medium">{p.data_limit_mb ? `${p.data_limit_mb} MB` : 'No limit'}</dd>
                <dt className="text-slate-500">Devices per code</dt>
                <dd className="font-medium">{p.shared_users}</dd>
              </dl>
              <div className="mt-3 flex flex-wrap gap-1">
                {(p.plan_routers ?? []).length === 0 && <Badge color="red">No router: tick one to sell it</Badge>}
                {(p.plan_routers ?? []).map((l) => (
                  <span key={l.router_id} title={l.profile_name}>
                    <Badge color={l.managed ? 'blue' : 'gray'}>{routerName(l.router_id)}</Badge>
                  </span>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => open(toForm(p), p)}>
                  Edit
                </Button>
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    setNotice(null);
                    remove.mutate(p);
                  }}
                >
                  {remove.isPending && remove.variables?.id === p.id ? <Spinner /> : null} Delete
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {oldMikroticket.length > 0 && (
        <details className="rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-700">
            Old MikroTicket plans ({oldMikroticket.length}) — switched off
          </summary>
          <p className="mt-2 text-sm text-slate-600">
            These were made from MikroTicket profiles. They are no longer sold in Hotzonex, but kept so past sales and reports keep their names.
            MikroTicket cards on your routers keep working and their sales are still counted.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {oldMikroticket.map((p) => (
              <li key={p.id} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                {p.name} · {formatSSP(p.price_ssp)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
