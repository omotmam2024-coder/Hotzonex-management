import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Button, Card, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatDataLimit } from '../../lib/dataLimit';
import { bareIp, formatBytes, formatDuration, formatJubaTime, formatSSP, timeAgo } from '../../lib/format';
import { useT } from '../../i18n';
import type { TKey } from '../../i18n/dictionaries';
import { supabase } from '../../lib/supabase';

interface Online {
  mac: string | null;
  ip: string | null;
  uptime: number | null;
  since: string | null;
}

interface Match {
  source: 'hotzonex' | 'router';
  code: string;
  status: string;
  router: string;
  site: string;
  checked_at: string | null;
  router_status: string;
  plan: string | null;
  plan_color: string | null;
  price_ssp: number | null;
  online: Online | null;
  first_used_at: string | null;
  // Hotzonex vouchers
  uptime_limit?: number;
  validity_seconds?: number | null;
  data_limit_mb?: number | null;
  printed_at?: string | null;
  sold_at?: string | null;
  sold_by?: string | null;
  payment_method?: string | null;
  amount_ssp?: number | null;
  voided?: boolean;
  expires_at?: string | null;
  uptime_used?: number;
  bytes_used?: number;
  // Codes the router has (MikroTicket and others)
  profile?: string | null;
  first_login_known?: boolean;
  last_seen_at?: string;
}

interface CheckResult {
  code: string;
  matches: Match[];
}

type Verdict = 'notUsed' | 'inUse' | 'usedLeft' | 'usedUp' | 'used' | 'off';

const VERDICT_STYLE: Record<Verdict, string> = {
  notUsed: 'bg-green-50 text-green-800 ring-green-200',
  inUse: 'bg-brand-50 text-brand-700 ring-brand-200',
  usedLeft: 'bg-amber-50 text-amber-900 ring-amber-200',
  used: 'bg-amber-50 text-amber-900 ring-amber-200',
  usedUp: 'bg-red-50 text-red-800 ring-red-200',
  off: 'bg-slate-100 text-slate-700 ring-slate-200',
};

/** Used or not, in one word: from what the router last reported. */
function verdictOf(m: Match): Verdict {
  if (m.source === 'router') return m.online ? 'inUse' : m.status === 'used' ? 'used' : 'notUsed';
  if (m.status === 'disabled') return 'off';
  if (m.status === 'expired') return 'usedUp';
  if (m.online) return 'inUse';
  if (m.first_used_at || m.status === 'active') return 'usedLeft';
  return 'notUsed';
}

/** The router has not reported for 10 minutes: the answer may be out of date. */
function stale(m: Match): boolean {
  return m.router_status !== 'online' || !m.checked_at || Date.now() - new Date(m.checked_at).getTime() > 10 * 60_000;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-slate-100 py-2 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-end font-medium text-slate-900">{children}</dd>
    </div>
  );
}

function MatchCard({ m }: { m: Match }) {
  const { t } = useT();
  const verdict = verdictOf(m);
  const timeLeft = m.uptime_limit !== undefined && m.uptime_used !== undefined ? Math.max(0, m.uptime_limit - m.uptime_used) : null;
  return (
    <Card className="space-y-3">
      <div className={`rounded-xl p-4 ring-1 ${VERDICT_STYLE[verdict]}`}>
        <div className="text-2xl font-extrabold">{t(`vouchers.check.v.${verdict}` as TKey)}</div>
        <div className="mt-1 text-sm">{t(`vouchers.check.vText.${verdict}` as TKey, { router: m.router })}</div>
      </div>

      {stale(m) && (
        <Alert tone="warning">{t('vouchers.check.stale', { when: timeAgo(m.checked_at) })}</Alert>
      )}

      <dl className="text-sm">
        <Row label={t('vouchers.check.code')}>
          <span dir="ltr" className="font-mono text-base">
            {m.code}
          </span>
        </Row>
        <Row label={t('common.plan')}>
          <span className="inline-flex items-center gap-2">
            {m.plan_color && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: m.plan_color }} />}
            {m.plan ?? '—'}
            {m.price_ssp ? ` · ${formatSSP(m.price_ssp)}` : ''}
          </span>
        </Row>
        <Row label={t('common.router')}>
          {m.router} · {m.site}
        </Row>

        {m.source === 'hotzonex' && (
          <Row label={t('vouchers.check.sold')}>
            {m.sold_at
              ? `${formatJubaTime(m.sold_at)}${m.sold_by ? ` · ${m.sold_by}` : ''}${m.payment_method ? ` · ${t(m.payment_method === 'mobile_money' ? 'vouchers.check.momo' : 'vouchers.check.cash')}` : ''}${m.voided ? ` · ${t('vouchers.check.voided')}` : ''}`
              : m.printed_at
                ? t('vouchers.check.printedNotSold', { when: formatJubaTime(m.printed_at) })
                : t('vouchers.check.notSold')}
          </Row>
        )}

        <Row label={t('vouchers.check.firstLogin')}>
          {m.first_used_at
            ? formatJubaTime(m.first_used_at)
            : m.source === 'router' && m.status === 'used'
              ? t('vouchers.check.beforeHotzonex')
              : t('vouchers.check.never')}
        </Row>

        {m.source === 'hotzonex' && m.uptime_used !== undefined && m.uptime_limit !== undefined && (
          <Row label={t('vouchers.check.timeUsed')}>
            {formatDuration(m.uptime_used)} / {formatDuration(m.uptime_limit)}
            {timeLeft !== null && verdict !== 'usedUp' && verdict !== 'notUsed' ? ` · ${t('vouchers.check.left', { time: formatDuration(timeLeft) })}` : ''}
          </Row>
        )}
        {m.source === 'hotzonex' && m.bytes_used !== undefined && (m.bytes_used > 0 || m.data_limit_mb) && (
          <Row label={t('vouchers.check.dataUsed')}>
            {formatBytes(m.bytes_used)}
            {m.data_limit_mb ? ` / ${formatDataLimit(m.data_limit_mb)}` : ''}
          </Row>
        )}
        {m.source === 'hotzonex' && m.expires_at && (
          <Row label={t('vouchers.check.expires')}>{formatJubaTime(m.expires_at)}</Row>
        )}
        {m.online && (
          <Row label={t('vouchers.check.onlineNow')}>
            <span dir="ltr">
              {[m.online.ip ? bareIp(m.online.ip) : null, m.online.mac || null, m.online.uptime ? formatDuration(m.online.uptime) : null].filter(Boolean).join(' · ') ||
                t('vouchers.check.yes')}
            </span>
          </Row>
        )}
        {m.source === 'router' && (
          <Row label={t('vouchers.check.onRouter')}>{t('vouchers.check.lastSeen', { when: timeAgo(m.last_seen_at) })}</Row>
        )}
        <Row label={t('vouchers.check.routerChecked')}>{timeAgo(m.checked_at)}</Row>
      </dl>
    </Card>
  );
}

/**
 * A customer complains or hands a card back: type its code and see at once whether it was used,
 * when, how much time and data are left, and who sold it. Every role (cashiers take complaints).
 */
export function CheckVoucherPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const code = (params.get('code') ?? '').replace(/\s/g, '');
  const [input, setInput] = useState(code);
  useEffect(() => setInput(code), [code]);

  const result = useQuery({
    queryKey: ['check-voucher', code],
    enabled: code.length > 0,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<CheckResult> => {
      const { data, error } = await supabase.rpc('check_voucher', { p_code: code });
      if (error) throw error;
      return data as unknown as CheckResult;
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = input.replace(/\s/g, '');
    if (!next) return;
    if (next === code) void result.refetch();
    else setParams({ code: next }, { replace: true });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={t('vouchers.check.title')} subtitle={t('vouchers.check.subtitle')} />
      <Card>
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <TextInput
              autoFocus
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              aria-label={t('vouchers.check.code')}
              placeholder={t('vouchers.check.placeholder')}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, 64))}
              className="font-mono text-lg"
            />
          </div>
          <Button type="submit" disabled={!input.trim() || result.isFetching} className="min-h-12">
            {result.isFetching && <Spinner />} {t('vouchers.check.button')}
          </Button>
        </form>
      </Card>

      {result.error && <Alert tone="error">{friendlyError(result.error)}</Alert>}
      {result.data && result.data.matches.length === 0 && (
        <Alert tone="warning">{t('vouchers.check.notFound', { code: result.data.code })}</Alert>
      )}
      {result.data && result.data.matches.length > 1 && <p className="text-sm text-slate-600">{t('vouchers.check.several', { n: result.data.matches.length })}</p>}
      {result.data?.matches.map((m, i) => <MatchCard key={`${m.source}-${m.router}-${i}`} m={m} />)}
    </div>
  );
}
