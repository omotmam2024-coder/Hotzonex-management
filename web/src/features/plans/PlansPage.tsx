import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ForceRemove } from '../../components/ForceRemove';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatDuration, formatSSP } from '../../lib/format';
import { cleanDataAmount, formatDataLimit, splitDataLimit, toMegabytes, type DataUnit } from '../../lib/dataLimit';
import { useT } from '../../i18n';
import { translate, translateMessage } from '../../i18n/translate';
import { invokeFunction } from '../../lib/functions';
import { RouterTimeoutError, waitForJob } from '../../lib/jobs';
import { profileLabel } from '../../lib/mikroticket';
import { usePlans, useRouters } from '../../hooks/queries';
import { supabase } from '../../lib/supabase';
import { planOnRouter, type Plan, type RouterInfo } from '../../lib/types';
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
  dataLimitAmount: string;
  dataUnit: DataUnit;
  sharedUsers: string;
  color: string;
  isActive: boolean;
  /** Routers ticked to carry the plan. */
  routerIds: string[];
}

/** A new plan, ticked only for the router whose plans are being shown (none when there is no router). */
function newPlan(routerIds: string[]): PlanForm {
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
    dataLimitAmount: '',
    dataUnit: 'GB',
    sharedUsers: '1',
    color: SWATCHES[0] ?? '#16a34a',
    isActive: true,
    routerIds,
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
    ...splitDataLimit(p.data_limit_mb),
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
  const { t } = useT();
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
    if (link) return link.managed ? t('plans.note.made') : t('plans.note.own', { profile: profileLabel(link.profile_name) });
    return r.status === 'pending' ? t('plans.note.pending') : t('plans.note.willMake');
  }

  const save = useMutation({
    mutationFn: async () => {
      const checked = validate(planSchema, {
        name: form.name,
        price_ssp: wholeNumber(form.price),
        uptime_seconds: wholeNumber(form.uptimeAmount) * UNIT_SECONDS[form.uptimeUnit],
        validity_seconds: form.hasValidity ? wholeNumber(form.validityAmount) * UNIT_SECONDS[form.validityUnit] : null,
        rate_limit: form.rateLimit,
        data_limit_mb: form.dataLimitAmount.trim() ? toMegabytes(form.dataLimitAmount.trim(), form.dataUnit) : null,
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
      const parts = [t('plans.saved', { name })];
      if (made) parts.push(t('plans.saved.adding', { n: made }));
      if (own) parts.push(t('plans.saved.own', { n: own }));
      const removedMade = (plan?.plan_routers ?? []).filter((l) => removed.includes(l.router_id) && l.managed).length;
      if (removedMade) parts.push(t('plans.saved.removing', { n: removedMade }));
      if (removed.length > removedMade) parts.push(t('plans.saved.noLonger', { n: removed.length - removedMade }));
      if (plan && !added.length && (plan.plan_routers ?? []).some((l) => l.managed)) parts.push(t('plans.saved.updated'));
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
        <h2 className="mb-1 text-lg font-bold">{form.id ? t('plans.editTitle', { name: initial.name }) : t('plans.newPlan')}</h2>
        <p className="mb-4 text-sm text-slate-600">{t('plans.editorIntro')}</p>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('plans.field.name')}>
              <TextInput value={form.name} maxLength={40} placeholder="2Hrs" onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label={t('plans.field.price')}>
              <TextInput inputMode="numeric" value={form.price} onChange={(e) => set('price', e.target.value.replace(/\D/g, ''))} placeholder="1500" />
            </Field>
            <Field label={t('plans.field.time')} hint={t('plans.field.timeHint')}>
              <div className="flex gap-2">
                <TextInput inputMode="numeric" value={form.uptimeAmount} onChange={(e) => set('uptimeAmount', e.target.value.replace(/\D/g, ''))} />
                <Select value={form.uptimeUnit} onChange={(e) => set('uptimeUnit', e.target.value as TimeUnit)}>
                  <option value="minutes">{t('plans.unit.minutes')}</option>
                  <option value="hours">{t('plans.unit.hours')}</option>
                  <option value="days">{t('plans.unit.days')}</option>
                </Select>
              </div>
            </Field>
            <div>
              <Field label={t('plans.field.validity')} hint={t('plans.field.validityHint')}>
                <div className="flex gap-2">
                  <TextInput
                    inputMode="numeric"
                    value={form.hasValidity ? form.validityAmount : ''}
                    disabled={!form.hasValidity}
                    placeholder={t('plans.noLimit')}
                    onChange={(e) => set('validityAmount', e.target.value.replace(/\D/g, ''))}
                  />
                  <Select value={form.validityUnit} disabled={!form.hasValidity} onChange={(e) => set('validityUnit', e.target.value as TimeUnit)}>
                    <option value="minutes">{t('plans.unit.minutes')}</option>
                    <option value="hours">{t('plans.unit.hours')}</option>
                    <option value="days">{t('plans.unit.days')}</option>
                  </Select>
                </div>
              </Field>
              <Checkbox label={t('plans.field.noValidity')} checked={!form.hasValidity} onChange={(v) => set('hasValidity', !v)} />
            </div>
            <Field label={t('plans.field.speed')} hint={t('plans.field.speedHint')}>
              <TextInput dir="ltr" value={form.rateLimit} onChange={(e) => set('rateLimit', e.target.value.replace(/\s/g, ''))} placeholder="2M/2M" />
            </Field>
            <Field label={t('plans.field.devices')} hint={t('plans.field.devicesHint')}>
              <TextInput inputMode="numeric" value={form.sharedUsers} onChange={(e) => set('sharedUsers', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label={t('plans.field.data')} hint={t('plans.field.dataHint')}>
              <div className="flex gap-2">
                <TextInput
                  inputMode={form.dataUnit === 'GB' ? 'decimal' : 'numeric'}
                  value={form.dataLimitAmount}
                  onChange={(e) => set('dataLimitAmount', cleanDataAmount(e.target.value, form.dataUnit))}
                  placeholder={t('plans.field.none')}
                />
                <Select
                  value={form.dataUnit}
                  onChange={(e) => {
                    const unit = e.target.value as DataUnit;
                    setForm((f) => ({ ...f, dataUnit: unit, dataLimitAmount: cleanDataAmount(f.dataLimitAmount, unit) }));
                  }}
                >
                  <option value="MB">{t('plans.unit.mb')}</option>
                  <option value="GB">{t('plans.unit.gb')}</option>
                </Select>
              </div>
            </Field>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">{t('plans.routersLabel')}</span>
            {routers.length === 0 && <p className="text-sm text-slate-500">{t('plans.noRouters')}</p>}
            <div className="grid gap-1 sm:grid-cols-2">
              {routers.map((r) => (
                <label key={r.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
                  <input type="checkbox" className="mt-0.5 h-5 w-5" checked={form.routerIds.includes(r.id)} onChange={() => toggleRouter(r.id)} />
                  <span>
                    <span className="block font-medium text-slate-900">{r.name}</span>
                    {form.routerIds.includes(r.id) && <span className="block text-xs text-slate-500">{routerNote(r)}</span>}
                    {!form.routerIds.includes(r.id) && linkOf(r.id) && (
                      <span className="block text-xs text-amber-700">
                        {linkOf(r.id)?.managed ? t('plans.unticked.made') : t('plans.unticked.own')}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {ownOnRouters.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">{t('plans.ownProfileNote')}</p>
            )}
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-slate-700">{t('plans.colourLabel')}</span>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={t('plans.colourAria', { c })}
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
                aria-label={t('plans.customColour')}
              />
            </div>
          </div>

          <Checkbox label={t('plans.activeLabel')} checked={form.isActive} onChange={(v) => set('isActive', v)} />

          {save.error && <Alert tone="error">{friendlyPlanError(save.error)}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />} {t('plans.savePlan')}
            </Button>
            <Button variant="ghost" onClick={() => onClose(false)}>
              {t('common.cancel')}
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
    if (e.message?.includes('router_profile_name') || e.message?.includes('plan_routers')) return translate('plans.err.duplicateRouter');
    return translate('plans.err.duplicateName');
  }
  return err instanceof Error && !e.code ? translateMessage(err.message) : friendlyError(err);
}

const TAB_KEY = 'hzc-plans-router';

export function PlansPage() {
  const plans = usePlans();
  const routersQuery = useRouters();
  const routers = routersQuery.data ?? [];
  const [editing, setEditing] = useState<{ form: PlanForm; plan: Plan | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forcePlan, setForcePlan] = useState<Plan | null>(null);
  const queryClient = useQueryClient();
  const { t } = useT();
  const routerName = (id: string) => routers.find((r) => r.id === id)?.name ?? t('common.router');
  // Each router's plans on their own tab ('none' = plans not on any router yet).
  const [tab, setTab] = useState<string>(() => {
    try {
      return localStorage.getItem(TAB_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const chooseTab = (id: string) => {
    setTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      // Not remembered on this device; still works.
    }
  };

  const remove = useMutation({
    mutationFn: async (p: Plan) => {
      const made = (p.plan_routers ?? []).some((l) => l.managed);
      const own = (p.plan_routers ?? []).some((l) => !l.managed);
      const what = [
        made ? t('plans.delete.made') : '',
        own ? t('plans.delete.own') : '',
      ].filter(Boolean);
      if (!window.confirm(t('plans.delete.confirm', { name: p.name, details: what.join(' ') }))) return null;
      const r = await invokeFunction<{ deleted?: boolean; removing?: number; kept_on_routers?: number; job_ids?: string[] }>('delete-items', { action: 'delete_plan', id: p.id });
      const kept = r.kept_on_routers ? ` ${t('plans.delete.kept')}` : '';
      if (r.deleted) return `${t('plans.deleted', { name: p.name })}${kept}`;
      // The routers delete the profile first; the plan goes once they have.
      try {
        const jobs = await Promise.all((r.job_ids ?? []).map((id) => waitForJob(id)));
        const failed = jobs.find((j) => j.status === 'failed');
        if (failed) throw new Error(String((failed.result as { error?: string } | null)?.error ?? t('plans.delete.routerFailed')));
        return t('plans.deletedFromRouter', { name: p.name });
      } catch (err) {
        if (err instanceof RouterTimeoutError) {
          return t('plans.switchedOff', { name: p.name });
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
  const unlinked = currentPlans.filter((p) => (p.plan_routers ?? []).length === 0);
  const tabs = [...routers.map((r) => ({ id: r.id, name: r.name, n: currentPlans.filter((p) => planOnRouter(p, r.id)).length }))];
  if (unlinked.length) tabs.push({ id: 'none', name: t('plans.tab.none'), n: unlinked.length });
  const activeTab = tabs.some((x) => x.id === tab) ? tab : (tabs[0]?.id ?? '');
  const shown = activeTab === 'none' ? unlinked : activeTab ? currentPlans.filter((p) => planOnRouter(p, activeTab)) : currentPlans;
  const tabRouter = routers.find((r) => r.id === activeTab);
  const startNew = () => open(newPlan(tabRouter ? [tabRouter.id] : []), null);

  function open(form: PlanForm, plan: Plan | null) {
    setNotice(null);
    setForcePlan(null);
    remove.reset();
    setEditing({ form, plan });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.plans')}
        subtitle={t('plans.subtitle')}
        actions={!editing && <Button onClick={startNew}>{tabRouter ? t('plans.newFor', { router: tabRouter.name }) : t('plans.newButton')}</Button>}
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      {remove.error && !forcePlan && (
        <div className="space-y-2">
          <Alert tone="error">{remove.error.message}</Alert>
          {remove.variables && (
            <Button variant="danger" onClick={() => setForcePlan(remove.variables ?? null)}>
              {t('force.openPlan', { name: remove.variables.name })}
            </Button>
          )}
        </div>
      )}
      {forcePlan && (
        <ForceRemove
          kind="plan"
          id={forcePlan.id}
          name={forcePlan.name}
          onClose={() => setForcePlan(null)}
          onDone={(text) => {
            setForcePlan(null);
            remove.reset();
            setNotice(text);
          }}
        />
      )}
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

      {tabs.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t('plans.tab.label')}>
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === activeTab}
              onClick={() => chooseTab(x.id)}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 font-semibold ring-1 ${x.id === activeTab ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
            >
              {x.name}
              <span className={`rounded-full px-2 text-xs ${x.id === activeTab ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{x.n}</span>
            </button>
          ))}
        </div>
      )}
      {tabRouter && <p className="text-sm text-slate-600">{t('plans.tab.text', { router: tabRouter.name })}</p>}

      {!plans.isLoading && shown.length === 0 && !editing && (
        <Card className="space-y-3 text-center">
          <p className="text-slate-700">{tabRouter ? t('plans.tab.empty', { router: tabRouter.name }) : t('plans.tab.emptyAll')}</p>
          <div>
            <Button onClick={startNew}>{tabRouter ? t('plans.newFor', { router: tabRouter.name }) : t('plans.newButton')}</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((p) => (
          <Card key={p.id} className={`overflow-hidden !p-0 ${p.is_active ? '' : 'opacity-60'}`}>
            <div className="h-1.5" style={{ backgroundColor: p.color }} />
            <div className="p-3">
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold leading-tight">{p.name}</div>
                  <div className="text-lg font-extrabold tabular-nums leading-tight">{formatSSP(p.price_ssp)}</div>
                </div>
                {!p.is_active && <Badge color="gray">{t('plans.off')}</Badge>}
              </div>
              <p className="mt-1.5 text-xs leading-snug text-slate-600">
                {formatDuration(p.uptime_seconds)} · {t('plans.card.valid', { d: p.validity_seconds ? formatDuration(p.validity_seconds) : t('plans.noLimit') })}
                <br />
                {p.rate_limit ?? t('plans.card.anySpeed')} · {p.data_limit_mb ? formatDataLimit(p.data_limit_mb) : t('plans.card.noDataLimit')} ·{' '}
                {t('plans.card.devices', { n: p.shared_users })}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(p.plan_routers ?? []).length === 0 && <Badge color="red">{t('plans.card.noRouter')}</Badge>}
                {(p.plan_routers ?? []).map((l) => (
                  <span key={l.router_id} title={l.profile_name}>
                    <Badge color={l.managed ? 'blue' : 'gray'}>{routerName(l.router_id)}</Badge>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <Button variant="secondary" className="min-h-11 flex-1 !px-2 text-sm" onClick={() => open(toForm(p), p)}>
                  {t('common.edit')}
                </Button>
                <Button
                  variant="danger"
                  className="min-h-11 !px-2 text-sm"
                  disabled={remove.isPending}
                  onClick={() => {
                    setNotice(null);
                    remove.mutate(p);
                  }}
                >
                  {remove.isPending && remove.variables?.id === p.id ? <Spinner /> : null} {t('common.delete')}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {oldMikroticket.length > 0 && (
        <details className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 sm:p-5">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-700">
            {t('plans.old.summary', { n: oldMikroticket.length })}
          </summary>
          <p className="mt-2 text-sm text-slate-600">{t('plans.old.text')}</p>
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
