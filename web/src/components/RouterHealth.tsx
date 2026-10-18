import { useQuery } from '@tanstack/react-query';
import { timeAgo } from '../lib/format';
import { useT } from '../i18n';
import { translate } from '../i18n/translate';
import { supabase } from '../lib/supabase';
import type { RouterInfo } from '../lib/types';

type Level = 'ok' | 'warn' | 'bad' | 'info';

interface Check {
  label: string;
  level: Level;
  text: string;
}

const MARK: Record<Level, string> = { ok: '✓', warn: '!', bad: '✕', info: '·' };
const COLOR: Record<Level, string> = {
  ok: 'bg-green-100 text-green-800',
  warn: 'bg-amber-100 text-amber-900',
  bad: 'bg-red-100 text-red-800',
  info: 'bg-slate-200 text-slate-700',
};

interface HealthData {
  ownLength: number | null;
  lastPush: { status: string; finished_at: string | null; result: Record<string, unknown> | null } | null;
  lastBatchLength: number | null;
  lastCleanup: { created_at: string; count: number } | null;
}

/** The usual length of the router's own numeric cards, from the users Hotzonex has seen on it. */
function commonLength(names: string[]): number | null {
  const counts = new Map<number, number>();
  for (const n of names) if (/^[0-9]{4,12}$/.test(n)) counts.set(n.length, (counts.get(n.length) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 5 ? best[0] : null;
}

function loginPage(router: RouterInfo): { level: Level; text: string } {
  const info = router.hotspot_info;
  const server = info?.servers.find((s) => s.name === router.hotspot_server) ?? info?.servers[0];
  const dir = info?.server_profiles.find((p) => p.name === server?.profile)?.html_directory;
  if (!dir) return { level: 'info', text: translate('routers.health.notRead') };
  if (/^mkt_/i.test(dir)) return { level: 'ok', text: translate('routers.health.mkt', { dir }) };
  if (dir === 'hotzonex') return { level: 'ok', text: translate('routers.health.hzPortal') };
  return { level: 'ok', text: translate('routers.health.ownPages', { dir }) };
}

/** One look at everything that makes cards work on this router. */
export function RouterHealth({ router }: { router: RouterInfo }) {
  const { t } = useT();
  const health = useQuery({
    queryKey: ['router-health', router.id],
    staleTime: 60_000,
    queryFn: async (): Promise<HealthData> => {
      const [logins, push, batch, cleanup] = await Promise.all([
        supabase.from('router_logins').select('username').eq('router_id', router.id).limit(500),
        supabase
          .from('router_jobs')
          .select('status, finished_at, result')
          .eq('router_id', router.id)
          .eq('type', 'push_vouchers')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('voucher_batches').select('code_length').eq('router_id', router.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase
          .from('audit_log')
          .select('created_at, details')
          .eq('action', 'router.expired_cards_removed')
          .eq('details->>router_id', router.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        ownLength: commonLength(((logins.data ?? []) as { username: string }[]).map((l) => l.username)),
        lastPush: (push.data as HealthData['lastPush']) ?? null,
        lastBatchLength: (batch.data?.code_length as number | undefined) ?? null,
        lastCleanup: cleanup.data ? { created_at: cleanup.data.created_at as string, count: Number((cleanup.data.details as { count?: number })?.count ?? 0) } : null,
      };
    },
  });

  const checks: Check[] = [];
  checks.push(
    router.status === 'online'
      ? { label: t('routers.health.answering'), level: 'ok', text: t('routers.health.checked', { ago: router.last_seen_at ? timeAgo(router.last_seen_at) : t('common.justNow') }) }
      : router.status === 'pending'
        ? { label: t('routers.health.answering'), level: 'warn', text: t('routers.health.notConnected') }
        : {
            label: t('routers.health.answering'),
            level: 'bad',
            text: router.last_seen_at ? t('routers.health.noAnswerSince', { ago: timeAgo(router.last_seen_at) }) : t('routers.health.noAnswerEver'),
          },
  );
  const page = loginPage(router);
  checks.push({ label: t('routers.health.loginPage'), ...page });

  const d = health.data;
  if (d) {
    if (d.ownLength) {
      const mismatch = d.lastBatchLength !== null && d.lastBatchLength !== d.ownLength;
      checks.push({
        label: t('routers.health.codeLength'),
        level: mismatch ? 'warn' : 'ok',
        text: mismatch ? t('routers.health.mismatch', { own: d.ownLength, last: d.lastBatchLength }) : t('routers.health.match', { n: d.ownLength }),
      });
    }
    if (d.lastPush) {
      const r = d.lastPush.result ?? {};
      const warnings = Array.isArray(r.warnings) ? (r.warnings as string[]) : [];
      const when = d.lastPush.finished_at ? timeAgo(d.lastPush.finished_at) : t('routers.health.inProgress');
      const lastCards = t('routers.health.lastCards');
      checks.push(
        d.lastPush.status === 'failed'
          ? { label: lastCards, level: 'bad', text: t('routers.health.failed', { when, error: String(r.error ?? t('routers.health.refused')) }) }
          : warnings.length
            ? { label: lastCards, level: 'warn', text: warnings.join(' ') }
            : {
                label: lastCards,
                level: 'ok',
                text: `${t('routers.health.added', { when })}${typeof r.checked_on_router === 'number' ? ` ${t('routers.health.checkedOn', { n: r.checked_on_router })}` : ''}${typeof r.profile === 'string' ? ` · ${t('routers.health.profile', { profile: r.profile.replace(/^profile_(.+?)-se:.*$/, '$1') })}` : ''}`,
              },
      );
    }
    checks.push(
      d.lastCleanup
        ? { label: t('routers.health.expired'), level: 'ok', text: t('routers.health.removedLast', { n: d.lastCleanup.count, ago: timeAgo(d.lastCleanup.created_at) }) }
        : { label: t('routers.health.expired'), level: 'info', text: t('routers.health.removedNone') },
    );
  }

  return (
    <ul className="space-y-2">
      {checks.map((c) => (
        <li key={c.label} className="flex items-start gap-2 text-sm">
          <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${COLOR[c.level]}`}>{MARK[c.level]}</span>
          <span>
            <span className="font-semibold text-slate-800">{c.label}:</span> <span className="text-slate-700">{c.text}</span>
          </span>
        </li>
      ))}
      {health.isLoading && <li className="text-sm text-slate-500">{t('routers.health.reading')}</li>}
    </ul>
  );
}
