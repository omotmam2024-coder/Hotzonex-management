import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Field, Select, Spinner, TextInput, textButtonClass } from '../../components/ui';
import { useT } from '../../i18n';
import { friendlyError } from '../../lib/errors';
import { formatJubaStamp, formatNumber, formatSSP } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { promoCodeSchema, referralSchema, validate } from '../../lib/validation';

interface Promo {
  id: string;
  code: string;
  kind: string;
  value: number;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
}

const KEY = ['promo-codes'];

function usePromos() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Promo[]> => {
      const { data, error } = await supabase
        .from('promo_codes')
        .select('id, code, kind, value, expires_at, max_uses, used_count, is_active')
        .eq('source', 'owner')
        .order('created_at', { ascending: false });
      if (error) throw new Error(friendlyError(error));
      return data ?? [];
    },
  });
}

/** The last day of an expiry as a date input value (the code works through the end of that day, Juba time). */
function expiryToIso(day: string): string | null {
  return day === '' ? null : new Date(`${day}T23:59:59+02:00`).toISOString();
}

function save(promo: { id: string | null; code: string; kind: string; value: number; expiresAt: string | null; maxUses: number | null; active: boolean }) {
  return supabase.rpc('save_promo_code', {
    p_id: promo.id,
    p_code: promo.code,
    p_kind: promo.kind,
    p_value: promo.value,
    p_expires_at: promo.expiresAt,
    p_max_uses: promo.maxUses,
    p_is_active: promo.active,
  });
}

function PromoForm({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('percent');
  const [value, setValue] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const v = validate(promoCodeSchema, { code, kind, value, expires_on: expiresOn, max_uses: maxUses });
      const { error } = await save({ id: null, code: v.code, kind: v.kind, value: v.value, expiresAt: expiryToIso(v.expires_on), maxUses: v.max_uses, active: true });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: onDone,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('promos.code')} hint={t('promos.codeHint')}>
          <TextInput value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 20))} maxLength={20} placeholder="NEWYEAR" dir="ltr" autoCapitalize="characters" />
        </Field>
        <Field label={t('promos.kind')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="percent">{t('promos.kindPercent')}</option>
            <option value="fixed">{t('promos.kindFixed')}</option>
          </Select>
        </Field>
        <Field label={kind === 'percent' ? t('promos.valuePercent') : t('promos.valueFixed')}>
          <TextInput value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))} inputMode="numeric" placeholder={kind === 'percent' ? '10' : '500'} dir="ltr" />
        </Field>
        <Field label={t('promos.expires')} hint={t('promos.expiresHint')}>
          <TextInput type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('promos.maxUses')} hint={t('promos.maxUsesHint')}>
          <TextInput value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))} inputMode="numeric" dir="ltr" />
        </Field>
      </div>
      {create.error && <Alert tone="error">{create.error.message}</Alert>}
      <Button type="submit" loading={create.isPending}>
        {t('promos.create')}
      </Button>
    </form>
  );
}

function state(p: Promo): 'active' | 'off' | 'expired' | 'usedUp' {
  if (!p.is_active) return 'off';
  if (p.expires_at && new Date(p.expires_at).getTime() <= Date.now()) return 'expired';
  if (p.max_uses !== null && p.used_count >= p.max_uses) return 'usedUp';
  return 'active';
}

const REFERRAL_KEY = ['referral-settings'];

/** The owner's "refer a friend" sizes: what a friend saves and what the customer who referred earns. Empty = off. */
function ReferralSettings() {
  const { t } = useT();
  const { business } = useAuth();
  const queryClient = useQueryClient();
  const [friend, setFriend] = useState('');
  const [reward, setReward] = useState('');
  const settings = useQuery({
    queryKey: [...REFERRAL_KEY, business?.id ?? ''],
    enabled: Boolean(business?.id),
    queryFn: async () => {
      const { data, error } = await supabase.from('tenants').select('referral_friend_percent, referral_reward_percent').eq('id', business?.id ?? '').maybeSingle();
      if (error) throw new Error(friendlyError(error));
      return { friend: data?.referral_friend_percent ?? null, reward: data?.referral_reward_percent ?? null };
    },
  });
  useEffect(() => {
    setFriend(settings.data?.friend ? String(settings.data.friend) : '');
    setReward(settings.data?.reward ? String(settings.data.reward) : '');
  }, [settings.data?.friend, settings.data?.reward]);

  const save = useMutation({
    mutationFn: async () => {
      const v = validate(referralSchema, { friend, reward });
      const { error } = await supabase.rpc('save_referral_settings', { p_friend_percent: v.friend, p_reward_percent: v.reward });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REFERRAL_KEY }),
  });

  const on = settings.data?.friend != null;
  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">{t('promos.referral.title')}</h2>
      <p className="mt-1 text-sm text-slate-600">{t('promos.referral.text')}</p>
      <form
        className="mt-3 space-y-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('promos.referral.friend')}>
            <TextInput value={friend} onChange={(e) => setFriend(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" placeholder="10" dir="ltr" />
          </Field>
          <Field label={t('promos.referral.reward')}>
            <TextInput value={reward} onChange={(e) => setReward(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" placeholder="20" dir="ltr" />
          </Field>
        </div>
        <p className="text-sm text-slate-600">{t('promos.referral.hint')}</p>
        {save.error && <Alert tone="error">{save.error.message}</Alert>}
        {save.isSuccess && <Alert tone="success">{t('promos.referral.saved')}</Alert>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={save.isPending}>
            {t('promos.referral.save')}
          </Button>
          <Badge color={on ? 'green' : 'gray'}>{on ? t('promos.referral.on') : t('promos.referral.off')}</Badge>
        </div>
      </form>
    </Card>
  );
}

/** The owner's promo codes: cashiers type a code when selling a card and the customer pays less. */
export function PromoCodesPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const promos = usePromos();
  const [adding, setAdding] = useState(false);

  const toggle = useMutation({
    mutationFn: async (p: Promo) => {
      const { error } = await save({ id: p.id, code: p.code, kind: p.kind, value: p.value, expiresAt: p.expires_at, maxUses: p.max_uses, active: !p.is_active });
      if (error) throw new Error(friendlyError(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('promos.title')}
        subtitle={t('promos.subtitle')}
        actions={!adding && <Button onClick={() => setAdding(true)}>{t('promos.add')}</Button>}
      />
      {adding && (
        <Card>
          <PromoForm
            onDone={() => {
              setAdding(false);
              void queryClient.invalidateQueries({ queryKey: KEY });
            }}
          />
        </Card>
      )}
      <ReferralSettings />
      {promos.error && <Alert tone="error">{friendlyError(promos.error)}</Alert>}
      {toggle.error && <Alert tone="error">{toggle.error.message}</Alert>}
      <Card>
        {promos.isLoading && <Spinner className="mx-auto block h-8 w-8 text-brand-600" />}
        {promos.data?.length === 0 && <p className="text-slate-600">{t('promos.none')}</p>}
        {promos.data && promos.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pe-3 text-start font-semibold">{t('promos.code')}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t('promos.discount')}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t('promos.used')}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t('promos.expires')}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t('promos.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {promos.data.map((p) => {
                  const st = state(p);
                  return (
                    <tr key={p.id} className="border-b border-slate-100">
                      <td className="py-2 pe-3 font-mono font-semibold" dir="ltr">{p.code}</td>
                      <td className="py-2 pe-3">{p.kind === 'percent' ? `${p.value}%` : formatSSP(p.value)}</td>
                      <td className="py-2 pe-3">{p.max_uses === null ? formatNumber(p.used_count) : `${formatNumber(p.used_count)} / ${formatNumber(p.max_uses)}`}</td>
                      <td className="py-2 pe-3">{p.expires_at ? formatJubaStamp(new Date(p.expires_at)) : t('promos.never')}</td>
                      <td className="py-2 pe-3">
                        <Badge color={st === 'active' ? 'green' : st === 'off' ? 'gray' : 'red'}>{t(`promos.state.${st}`)}</Badge>
                      </td>
                      <td className="py-2 text-end">
                        <button type="button" className={`${textButtonClass} text-brand-700`} disabled={toggle.isPending} onClick={() => toggle.mutate(p)}>
                          {p.is_active ? t('promos.switchOff') : t('promos.switchOn')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
