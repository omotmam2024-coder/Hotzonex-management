import { useQuery } from '@tanstack/react-query';
import { timeAgo } from '../lib/format';
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
  if (!dir) return { level: 'info', text: 'Not read yet: press “Test connection” to read it.' };
  if (/^mkt_/i.test(dir)) return { level: 'ok', text: `MikroTicket's login page (${dir}) — codes as long as its own cards` };
  if (dir === 'hotzonex') return { level: 'ok', text: 'Hotzonex login portal' };
  return { level: 'ok', text: `The router's own pages (${dir})` };
}

/** One look at everything that makes cards work on this router. */
export function RouterHealth({ router }: { router: RouterInfo }) {
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
      ? { label: 'Answering', level: 'ok', text: `Checked ${router.last_seen_at ? timeAgo(router.last_seen_at) : 'just now'}` }
      : router.status === 'pending'
        ? { label: 'Answering', level: 'warn', text: 'Not connected yet' }
        : { label: 'Answering', level: 'bad', text: `No answer since ${router.last_seen_at ? timeAgo(router.last_seen_at) : 'it was added'}` },
  );
  const page = loginPage(router);
  checks.push({ label: 'Login page', ...page });

  const d = health.data;
  if (d) {
    if (d.ownLength) {
      const mismatch = d.lastBatchLength !== null && d.lastBatchLength !== d.ownLength;
      checks.push({
        label: 'Code length',
        level: mismatch ? 'warn' : 'ok',
        text: mismatch
          ? `Router's own cards: ${d.ownLength} digits, but the last Hotzonex batch had ${d.lastBatchLength}. Use ${d.ownLength}.`
          : `${d.ownLength} digits, like the router's own cards`,
      });
    }
    if (d.lastPush) {
      const r = d.lastPush.result ?? {};
      const warnings = Array.isArray(r.warnings) ? (r.warnings as string[]) : [];
      const when = d.lastPush.finished_at ? timeAgo(d.lastPush.finished_at) : 'in progress';
      checks.push(
        d.lastPush.status === 'failed'
          ? { label: 'Last cards', level: 'bad', text: `Failed ${when}: ${String(r.error ?? 'the router refused them')}` }
          : warnings.length
            ? { label: 'Last cards', level: 'warn', text: warnings.join(' ') }
            : {
                label: 'Last cards',
                level: 'ok',
                text: `Added ${when}${typeof r.checked_on_router === 'number' ? ` and checked on the router (${r.checked_on_router})` : ''}${typeof r.profile === 'string' ? ` · profile ${r.profile.replace(/^profile_(.+?)-se:.*$/, '$1')}` : ''}`,
              },
      );
    }
    checks.push(
      d.lastCleanup
        ? { label: 'Expired cards', level: 'ok', text: `Removed automatically (last: ${d.lastCleanup.count}, ${timeAgo(d.lastCleanup.created_at)})` }
        : { label: 'Expired cards', level: 'info', text: 'Removed automatically when their time is over (none needed yet)' },
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
      {health.isLoading && <li className="text-sm text-slate-500">Reading…</li>}
    </ul>
  );
}
