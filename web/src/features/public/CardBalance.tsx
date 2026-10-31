import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useT } from '../../i18n';
import { formatDataLimit } from '../../lib/dataLimit';
import { friendlyError } from '../../lib/errors';
import { formatDuration, formatJubaTime } from '../../lib/format';
import { callPublicFunction } from '../../lib/functions';

type Balance =
  | { found: false }
  | { found: true; plan: string; state: 'active' | 'finished'; seconds_left: number | null; mb_left: number | null; expires_at: string | null; referral?: boolean };

type Referral =
  | { found: false }
  | { found: true; enabled: false }
  | { found: true; enabled: true; active: false }
  | { found: true; enabled: true; active: true; code: string; friend_percent: number; reward_percent: number; uses_left: number; rewards: { code: string; percent: number; expires_at: string | null }[] };

const input =
  'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

/**
 * Public "Check my card" box on the Buy page: a customer types the code of a card they are using and
 * sees how much time or data is left. The server shows only cards already in use (never confirms that
 * an unused code exists) and limits the checks.
 */
/** "Refer a friend": the customer's personal code, and the reward codes they have earned. */
function ReferralPanel({ slug, code }: { slug: string; code: string }) {
  const { t } = useT();
  const get = useMutation({ mutationFn: () => callPublicFunction<Referral>('buy', { action: 'referral', slug, code }) });
  const r = get.data;

  function share(refCode: string, percent: number) {
    const text = t('public.referral.shareText', { percent, code: refCode, url: window.location.href });
    if (typeof navigator.share === 'function') void navigator.share({ text }).catch(() => undefined);
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      {!r && (
        <button type="button" onClick={() => get.mutate()} disabled={get.isPending} className="min-h-12 w-full rounded-xl bg-accent-700 px-4 font-semibold text-white hover:bg-accent-800 disabled:opacity-50">
          {get.isPending ? t('public.balance.checking') : t('public.referral.button')}
        </button>
      )}
      {get.error && <p className="mt-2 rounded-xl bg-red-50 p-3 font-medium text-red-800">{friendlyError(get.error)}</p>}
      {r && (!r.found || !r.enabled || !r.active) && <p className="rounded-xl bg-amber-50 p-3 text-amber-900">{t('public.referral.unavailable')}</p>}
      {r?.found && r.enabled && r.active && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm text-slate-700">{t('public.referral.explain', { friend: r.friend_percent, reward: r.reward_percent })}</p>
          <p className="rounded-xl bg-accent-50 p-3 text-center font-mono text-2xl font-extrabold tracking-wider text-accent-800" dir="ltr">{r.code}</p>
          <p className="text-xs text-slate-500">{t('public.referral.usesLeft', { n: r.uses_left })}</p>
          <button type="button" onClick={() => share(r.code, r.friend_percent)} className="min-h-12 w-full rounded-xl bg-brand-600 px-4 font-semibold text-white">
            {t('common.share')}
          </button>
          {r.rewards.length > 0 && (
            <div className="rounded-xl bg-green-50 p-3 text-green-900">
              <p className="font-semibold">{t('public.referral.rewards')}</p>
              {r.rewards.map((w) => (
                <p key={w.code}>
                  <span className="font-mono font-bold" dir="ltr">{w.code}</span> — {t('public.referral.percentOff', { percent: w.percent })}
                  {w.expires_at ? ` (${t('public.referral.until', { date: formatJubaTime(w.expires_at) })})` : ''}
                </p>
              ))}
              <p className="mt-1 text-sm">{t('public.referral.showCashier')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CardBalance({ slug }: { slug: string }) {
  const { t } = useT();
  const [code, setCode] = useState('');
  const check = useMutation({
    mutationFn: () => callPublicFunction<Balance>('buy', { action: 'balance', slug, code }),
  });
  const result = check.data;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (code.trim()) check.mutate();
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-xl">
      <h2 className="text-lg font-bold text-slate-900">{t('public.balance.title')}</h2>
      <p className="mt-1 text-sm text-slate-600">{t('public.balance.hint')}</p>
      <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/[^0-9A-Za-z ]/g, '').slice(0, 24));
            if (check.data || check.error) check.reset();
          }}
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          className={input}
          placeholder={t('public.balance.placeholder')}
          aria-label={t('public.balance.code')}
        />
        <button type="submit" disabled={check.isPending || !code.trim()} className="min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white disabled:opacity-50">
          {check.isPending ? t('public.balance.checking') : t('public.balance.check')}
        </button>
      </form>

      {check.error && <p className="mt-3 rounded-xl bg-red-50 p-3 font-medium text-red-800">{friendlyError(check.error)}</p>}
      {result && !result.found && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-amber-900">{t('public.balance.notFound')}</p>}
      {result?.found && (
        <div className="mt-3 space-y-1 rounded-xl bg-slate-50 p-3 text-slate-800" aria-live="polite">
          <p className="flex items-center justify-between gap-2">
            <span className="font-semibold">{result.plan}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${result.state === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {result.state === 'active' ? t('public.balance.active') : t('public.balance.finished')}
            </span>
          </p>
          {result.seconds_left !== null && (
            <p>
              {t('public.balance.timeLeft')}: <strong>{formatDuration(result.seconds_left)}</strong>
            </p>
          )}
          {result.mb_left !== null && (
            <p>
              {t('public.balance.dataLeft')}: <strong>{formatDataLimit(result.mb_left)}</strong>
            </p>
          )}
          {result.expires_at && (
            <p>
              {t('public.balance.validUntil')}: <strong>{formatJubaTime(result.expires_at)}</strong>
            </p>
          )}
          <p className="pt-1 text-xs text-slate-500">{t('public.balance.updated')}</p>
          {result.state === 'finished' && <p className="font-semibold text-brand-700">{t('public.balance.needMore')}</p>}
          {result.state === 'active' && result.referral && <ReferralPanel key={code} slug={slug} code={code} />}
        </div>
      )}
    </div>
  );
}
