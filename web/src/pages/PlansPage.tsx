import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { formatDuration, formatSSP } from '../lib/format';
import { invokeFunction } from '../lib/functions';
import { RouterTimeoutError, waitForJob } from '../lib/jobs';
import { parseMikroticketProfile, profileLabel } from '../lib/mikroticket';
import { usePlans, useRouters } from '../lib/queries';
import { supabase } from '../lib/supabase';
import type { HotspotInfo, Plan } from '../lib/types';

type RouterProfile = HotspotInfo['user_profiles'][number];
const NEW_PROFILE = '__new__';
const RATE_RE = /^\d+[kKmMgG]?\/\d+[kKmMgG]?$/;

const SWATCHES = ['#16a34a', '#2563eb', '#dc2626', '#f59e0b', '#7c3aed', '#db2777', '#0891b2', '#475569'];

type TimeUnit = 'minutes' | 'hours' | 'days';
const UNIT_SECONDS: Record<TimeUnit, number> = { minutes: 60, hours: 3600, days: 86400 };

/** Picks the largest unit that divides the seconds evenly, for editing. */
function splitDuration(seconds: number): { amount: string; unit: TimeUnit } {
  if (seconds % 86400 === 0) return { amount: String(seconds / 86400), unit: 'days' };
  if (seconds % 3600 === 0) return { amount: String(seconds / 3600), unit: 'hours' };
  return { amount: String(Math.round(seconds / 60)), unit: 'minutes' };
}

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
  profileName: string;
  profileTouched: boolean;
  /** 'router': a user profile already on the router (e.g. made by MikroTicket); 'new': Hotzonex adds it. */
  profileMode: 'router' | 'new';
  isActive: boolean;
}

const NEW_PLAN: PlanForm = {
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
  profileName: '',
  profileTouched: false,
  profileMode: 'router',
  isActive: true,
};

function toForm(p: Plan, routerProfiles: RouterProfile[]): PlanForm {
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
    profileName: p.router_profile_name,
    profileTouched: true,
    profileMode: routerProfiles.some((r) => r.name === p.router_profile_name) ? 'router' : 'new',
    isActive: p.is_active,
  };
}

function slugProfile(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug ? `hzc-${slug}` : '';
}

const wholeNumber = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);

/** Every user profile found on the routers at their last check, without duplicates. */
function useRouterProfiles(): RouterProfile[] {
  const routers = useRouters();
  const byName = new Map<string, RouterProfile>();
  for (const r of routers.data ?? []) for (const up of r.hotspot_info?.user_profiles ?? []) if (!byName.has(up.name)) byName.set(up.name, up);
  return [...byName.values()];
}

/** Profiles the router owner made: not RouterOS's "default" and not one Hotzonex added (hzc-…). */
const isOwnProfile = (name: string) => Boolean(name) && name !== 'default' && !name.startsWith('hzc-');

function PlanEditor({
  initial,
  routerProfiles,
  usedProfiles,
  onClose,
}: {
  initial: PlanForm;
  routerProfiles: RouterProfile[];
  usedProfiles: Set<string>;
  onClose: (saved: boolean) => void;
}) {
  const queryClient = useQueryClient();
  // Hotzonex makes its own profile only when the routers have none of their own.
  const canMakeProfile = !routerProfiles.some((r) => isOwnProfile(r.name)) || initial.profileMode === 'new';
  const choices = routerProfiles.filter((r) => isOwnProfile(r.name) || r.name === 'default' || r.name === initial.profileName);
  const [form, setForm] = useState<PlanForm>(initial.profileMode === 'router' && !choices.length ? { ...initial, profileMode: 'new' } : initial);
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const routerProfile = form.profileMode === 'router' ? routerProfiles.find((r) => r.name === form.profileName) : undefined;

  function chooseProfile(value: string) {
    if (value === NEW_PROFILE) {
      setForm((f) => ({ ...f, profileMode: 'new', profileName: slugProfile(f.name), profileTouched: false }));
      return;
    }
    setForm((f) => {
      const next: PlanForm = { ...f, profileMode: 'router', profileName: value, profileTouched: true };
      const mt = parseMikroticketProfile(value);
      if (mt && !f.id) {
        // Fill the plan from what MikroTicket stored in the profile name.
        const up = splitDuration(mt.uptimeSeconds);
        const val = mt.validitySeconds ? splitDuration(Math.max(3600, Math.round(mt.validitySeconds / 3600) * 3600)) : null;
        Object.assign(next, {
          name: f.name.trim() ? f.name : mt.label,
          price: mt.price > 0 ? String(mt.price) : f.price,
          uptimeAmount: up.amount,
          uptimeUnit: up.unit,
          hasValidity: Boolean(val),
          ...(val ? { validityAmount: val.amount, validityUnit: val.unit } : {}),
        });
      }
      return next;
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      if (!name) throw new Error('Plan name is required.');
      const price = wholeNumber(form.price);
      if (!(price > 0)) throw new Error('Price must be a whole number of SSP above 0.');
      const uptime = wholeNumber(form.uptimeAmount) * UNIT_SECONDS[form.uptimeUnit];
      if (!(uptime > 0)) throw new Error('Time allowed must be above 0.');
      const validity = form.hasValidity ? wholeNumber(form.validityAmount) * UNIT_SECONDS[form.validityUnit] : null;
      if (validity !== null && !(validity > 0)) throw new Error('Validity must be above 0, or switch it off.');
      // A profile already on the router keeps its own speed and shared users; they are only copied for display.
      const rate = routerProfile ? (RATE_RE.test(routerProfile.rate_limit) ? routerProfile.rate_limit : '') : form.rateLimit.trim();
      if (rate && !RATE_RE.test(rate)) throw new Error('Speed limit must look like 2M/2M (upload/download).');
      const data = form.dataLimitMb.trim() ? wholeNumber(form.dataLimitMb.trim()) : null;
      if (data !== null && !(data > 0)) throw new Error('Data limit must be a whole number of MB, or empty for no limit.');
      const routerShared = Number(routerProfile?.shared_users);
      const shared = routerProfile ? (routerShared >= 1 && routerShared <= 50 ? routerShared : 1) : wholeNumber(form.sharedUsers);
      if (!(shared >= 1 && shared <= 50)) throw new Error('Shared users must be from 1 to 50.');
      const profile = form.profileMode === 'router' ? form.profileName : form.profileName.trim();
      if (form.profileMode === 'router') {
        if (!routerProfile) throw new Error('Choose the router user profile for this plan.');
      } else if (!/^[A-Za-z0-9_.-]{1,64}$/.test(profile)) {
        throw new Error('A new profile name may use letters, numbers, - _ and . only.');
      }

      const row = {
        name,
        price_ssp: price,
        uptime_seconds: uptime,
        validity_seconds: validity,
        rate_limit: rate || null,
        data_limit_mb: data,
        shared_users: shared,
        color: form.color,
        router_profile_name: profile,
        is_active: form.isActive,
      };
      const { error } = form.id ? await supabase.from('plans').update(row).eq('id', form.id) : await supabase.from('plans').insert(row);
      if (error) {
        if (error.code === '23505')
          throw new Error(error.message.includes('router_profile_name') ? `Profile name "${profile}" is already used by another plan.` : `A plan named "${name}" already exists.`);
        throw new Error(friendlyError(error));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      onClose(true);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">{form.id ? `Edit ${initial.name}` : 'New plan'}</h2>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan name">
            <TextInput
              value={form.name}
              maxLength={40}
              placeholder="2 Hours"
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({ ...f, name, profileName: f.profileTouched || f.profileMode === 'router' ? f.profileName : slugProfile(name) }));
              }}
            />
          </Field>
          <Field label="Price (SSP)">
            <TextInput inputMode="numeric" value={form.price} onChange={(e) => set('price', e.target.value.replace(/\D/g, ''))} placeholder="1000" />
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
                <option value="hours">hours</option>
                <option value="days">days</option>
              </Select>
            </div>
          </Field>
          {form.profileMode === 'new' && (
            <Field label="Speed limit (upload/download)" hint="RouterOS rate-limit, e.g. 2M/2M or 512k/1M. Empty = no limit">
              <TextInput value={form.rateLimit} onChange={(e) => set('rateLimit', e.target.value.replace(/\s/g, ''))} placeholder="2M/2M" />
            </Field>
          )}
          <Field label="Data limit (MB)" hint="Empty = no data limit">
            <TextInput inputMode="numeric" value={form.dataLimitMb} onChange={(e) => set('dataLimitMb', e.target.value.replace(/\D/g, ''))} placeholder="none" />
          </Field>
          {form.profileMode === 'new' && (
            <Field label="Shared users" hint="Devices that may use one code at the same time">
              <TextInput inputMode="numeric" value={form.sharedUsers} onChange={(e) => set('sharedUsers', e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}
          <Field
            label="Router user profile"
            hint={
              routerProfile
                ? `Uses the router's own profile as it is: speed ${routerProfile.rate_limit || 'no limit'}, ${routerProfile.shared_users || 1} device(s) per code. Hotzonex never changes it.`
                : form.profileMode === 'new'
                  ? 'Hotzonex adds this profile, with the speed and shared users above, to routers that do not have it.'
                  : 'Choose one of the profiles on your router, e.g. the ones MikroTicket made. Hotzonex adds its own profile only to a router that has none.'
            }
          >
            <Select value={form.profileMode === 'new' ? NEW_PROFILE : form.profileName} onChange={(e) => chooseProfile(e.target.value)}>
              {form.profileMode === 'router' && !routerProfile && <option value={form.profileName}>Choose a profile…</option>}
              {choices.map((r) => (
                <option key={r.name} value={r.name} disabled={usedProfiles.has(r.name) && r.name !== initial.profileName}>
                  {profileLabel(r.name)}
                  {usedProfiles.has(r.name) && r.name !== initial.profileName ? ' — used by another plan' : ''}
                </option>
              ))}
              {canMakeProfile && <option value={NEW_PROFILE}>+ New profile (Hotzonex adds it to the router)</option>}
            </Select>
          </Field>
          {form.profileMode === 'new' && (
            <Field label="New profile name" hint="Letters, numbers, - _ and . only">
              <TextInput
                value={form.profileName}
                onChange={(e) => setForm((f) => ({ ...f, profileName: e.target.value, profileTouched: true }))}
                placeholder="hzc-2h"
              />
            </Field>
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

        <div className="flex flex-wrap gap-x-6">
          <Checkbox label="Validity limit after first login" checked={form.hasValidity} onChange={(v) => set('hasValidity', v)} />
          <Checkbox label="Plan active (can be sold and generated)" checked={form.isActive} onChange={(v) => set('isActive', v)} />
        </div>

        {save.error && <Alert tone="error">{save.error.message}</Alert>}
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
  );
}

export function PlansPage() {
  const plans = usePlans();
  const routerProfiles = useRouterProfiles();
  const [editing, setEditing] = useState<PlanForm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async (p: Plan) => {
      if (
        !window.confirm(
          `Delete plan ${p.name}? Its profile is deleted from your routers too. If hotspot users still use that profile, the router keeps it and the plan is only switched off.`,
        )
      )
        return null;
      const r = await invokeFunction<{ deleted?: boolean; removing?: number; job_ids?: string[] }>('delete-items', { action: 'delete_plan', id: p.id });
      if (r.deleted) return `${p.name} deleted.`;
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
  const usedProfiles = new Set((plans.data ?? []).map((p) => p.router_profile_name));
  // Profiles on the router that are not plans yet (no price in their name, e.g. Guest): the admin can make them plans.
  const withoutPlan = routerProfiles.filter((r) => isOwnProfile(r.name) && !usedProfiles.has(r.name));

  function planFor(r: RouterProfile): PlanForm {
    const mt = parseMikroticketProfile(r.name);
    const up = mt ? splitDuration(mt.uptimeSeconds) : null;
    return {
      ...NEW_PLAN,
      name: mt?.label ?? r.name.slice(0, 40),
      price: mt && mt.price > 0 ? String(mt.price) : '',
      ...(up ? { uptimeAmount: up.amount, uptimeUnit: up.unit } : {}),
      hasValidity: mt ? mt.validitySeconds !== null : true,
      profileName: r.name,
      profileTouched: true,
      profileMode: 'router',
    };
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Plans"
        subtitle="Your router's user profiles are your plans: each MikroTicket profile (with a price and a time) becomes a plan by itself, and new ones are picked up within a minute. Hotzonex adds its own profiles only to a router that has none."
        actions={
          !editing && (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setNotice(null);
                  setEditing(NEW_PLAN);
                }}
              >
                + New plan
              </Button>
            </div>
          )
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      {remove.error && <Alert tone="error">{remove.error.message}</Alert>}
      {editing && (
        <PlanEditor
          key={editing.id ?? 'new'}
          initial={editing}
          routerProfiles={routerProfiles}
          usedProfiles={usedProfiles}
          onClose={(saved) => {
            setEditing(null);
            if (saved) setNotice('Plan saved. Profiles already on the router are used as they are and never changed; a new profile is added to routers within a few seconds.');
          }}
        />
      )}

      {!editing && withoutPlan.length > 0 && (
        <Card>
          <h2 className="font-bold text-slate-900">Other profiles on your router</h2>
          <p className="text-sm text-slate-600">These have no price in their name, so they are not plans yet. Give one a price to sell it.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {withoutPlan.map((r) => (
              <Button
                key={r.name}
                variant="secondary"
                onClick={() => {
                  setNotice(null);
                  setEditing(planFor(r));
                }}
              >
                {profileLabel(r.name)} → make a plan
              </Button>
            ))}
          </div>
        </Card>
      )}

      {plans.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
      {plans.error && <Alert tone="error">{friendlyError(plans.error)}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(plans.data ?? []).map((p) => (
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
                <dt className="text-slate-500">Shared users</dt>
                <dd className="font-medium">{p.shared_users}</dd>
                <dt className="text-slate-500">Profile</dt>
                <dd className="truncate text-xs leading-5" title={p.router_profile_name}>
                  {profileLabel(p.router_profile_name)}
                </dd>
              </dl>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setNotice(null);
                    remove.reset();
                    setEditing(toForm(p, routerProfiles));
                  }}
                >
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
    </div>
  );
}
