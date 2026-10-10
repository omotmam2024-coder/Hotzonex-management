import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { formatDuration, formatSSP } from '../lib/format';
import { usePlans } from '../lib/queries';
import { supabase } from '../lib/supabase';
import type { Plan } from '../lib/types';

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
  isActive: true,
};

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
    profileName: p.router_profile_name,
    profileTouched: true,
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

function PlanEditor({ initial, onClose }: { initial: PlanForm; onClose: (saved: boolean) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlanForm>(initial);
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm((f) => ({ ...f, [key]: value }));

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
      const rate = form.rateLimit.trim();
      if (rate && !/^\d+[kKmMgG]?\/\d+[kKmMgG]?$/.test(rate)) throw new Error('Speed limit must look like 2M/2M (upload/download).');
      const data = form.dataLimitMb.trim() ? wholeNumber(form.dataLimitMb.trim()) : null;
      if (data !== null && !(data > 0)) throw new Error('Data limit must be a whole number of MB, or empty for no limit.');
      const shared = wholeNumber(form.sharedUsers);
      if (!(shared >= 1 && shared <= 50)) throw new Error('Shared users must be from 1 to 50.');
      const profile = form.profileName.trim();
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(profile)) throw new Error('RouterOS profile name may use letters, numbers, - _ and . only.');

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
                setForm((f) => ({ ...f, name, profileName: f.profileTouched ? f.profileName : slugProfile(name) }));
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
          <Field label="Speed limit (upload/download)" hint="RouterOS rate-limit, e.g. 2M/2M or 512k/1M. Empty = no limit">
            <TextInput value={form.rateLimit} onChange={(e) => set('rateLimit', e.target.value.replace(/\s/g, ''))} placeholder="2M/2M" />
          </Field>
          <Field label="Data limit (MB)" hint="Empty = no data limit">
            <TextInput inputMode="numeric" value={form.dataLimitMb} onChange={(e) => set('dataLimitMb', e.target.value.replace(/\D/g, ''))} placeholder="none" />
          </Field>
          <Field label="Shared users" hint="Devices that may use one code at the same time">
            <TextInput inputMode="numeric" value={form.sharedUsers} onChange={(e) => set('sharedUsers', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="RouterOS profile name" hint="Hotspot user profile created on every router">
            <TextInput
              value={form.profileName}
              onChange={(e) => setForm((f) => ({ ...f, profileName: e.target.value, profileTouched: true }))}
              placeholder="hzc-2h"
            />
          </Field>
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
  const [editing, setEditing] = useState<PlanForm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Plans"
        subtitle="Price plans for vouchers. Saving a plan updates its hotspot profile on every router."
        actions={
          !editing && (
            <Button
              onClick={() => {
                setNotice(null);
                setEditing(NEW_PLAN);
              }}
            >
              + New plan
            </Button>
          )
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      {editing && (
        <PlanEditor
          key={editing.id ?? 'new'}
          initial={editing}
          onClose={(saved) => {
            setEditing(null);
            if (saved) setNotice('Plan saved. The Router Agent will update the profile on every online router within a few seconds.');
          }}
        />
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
                <dd className="truncate font-mono text-xs leading-5">{p.router_profile_name}</dd>
              </dl>
              <Button
                variant="secondary"
                className="mt-4 w-full"
                onClick={() => {
                  setNotice(null);
                  setEditing(toForm(p));
                }}
              >
                Edit
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
