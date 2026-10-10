import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Spinner } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { formatNumber } from '../lib/format';
import { supabase } from '../lib/supabase';
import { CardSheet } from '../print/CardSheet';
import { LAYOUTS, type CardsPerPage } from '../print/layouts';
import type { CardData } from '../print/VoucherCard';

const MAX_CARDS = 1000;

interface VoucherRow {
  id: string;
  code: string;
  router_id: string;
  plan_id: string;
  site_id: string;
}

async function loadCards(params: URLSearchParams): Promise<CardData[]> {
  const batch = params.get('batch');
  const router = params.get('router');
  const plan = params.get('plan');
  const limit = Math.min(MAX_CARDS, Number(params.get('count')) || MAX_CARDS);

  // Only vouchers that are really on the router can be printed.
  let q = supabase.from('vouchers').select('id, code, router_id, plan_id, site_id').eq('on_router', true).neq('status', 'disabled');
  if (batch) q = q.eq('batch_id', batch);
  else if (router) {
    q = q.eq('router_id', router).eq('status', 'unused');
    if (plan) q = q.eq('plan_id', plan);
    if (params.get('new') !== '0') q = q.is('printed_at', null);
  } else throw new Error('Choose a batch or a router first.');

  const { data, error } = await q.order('plan_id').order('code').limit(limit);
  if (error) throw new Error(error.message);
  const vouchers = (data ?? []) as VoucherRow[];
  if (vouchers.length === 0) return [];

  const routerIds = [...new Set(vouchers.map((v) => v.router_id))];
  const planIds = [...new Set(vouchers.map((v) => v.plan_id))];
  const siteIds = [...new Set(vouchers.map((v) => v.site_id))];
  const [routers, plans, sites] = await Promise.all([
    supabase.from('routers').select('id, dns_name').in('id', routerIds),
    supabase.from('plans').select('id, price_ssp, uptime_seconds, color').in('id', planIds),
    supabase.from('sites').select('id, name').in('id', siteIds),
  ]);
  const err = routers.error ?? plans.error ?? sites.error;
  if (err) throw new Error(err.message);

  const dns = new Map((routers.data ?? []).map((r) => [r.id as string, r.dns_name as string]));
  const planMap = new Map((plans.data ?? []).map((p) => [p.id as string, p]));
  const siteMap = new Map((sites.data ?? []).map((s) => [s.id as string, s.name as string]));

  return vouchers.map((v) => {
    const p = planMap.get(v.plan_id);
    return {
      id: v.id,
      code: v.code,
      siteName: siteMap.get(v.site_id) ?? '',
      dnsName: dns.get(v.router_id) ?? '',
      planColor: (p?.color as string) ?? '#000000',
      priceSsp: (p?.price_ssp as number) ?? 0,
      uptimeSeconds: (p?.uptime_seconds as number) ?? 0,
    };
  });
}

export function PrintSheetPage() {
  const [params] = useSearchParams();
  const requested = Number(params.get('per'));
  const cards = useQuery({ queryKey: ['print-sheet', params.toString()], queryFn: () => loadCards(params), staleTime: Infinity });
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState<string[] | null>(null);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = cards.data ?? [];
  const longest = list.reduce((m, c) => Math.max(m, c.code.length), 0);
  let perPage: CardsPerPage = requested === 24 || requested === 50 ? requested : 40;
  if (longest > LAYOUTS[perPage].maxCodeLength) perPage = 40;
  const pages = Math.ceil(list.length / perPage);

  async function handlePrint() {
    setError(null);
    setUndone(false);
    setMarking(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('mark_vouchers_printed', { p_voucher_ids: list.map((c) => c.id) });
      if (rpcError) throw new Error(friendlyError(rpcError));
      setMarked((data as string[] | null) ?? []);
    } catch (err) {
      setError(friendlyError(err));
      return;
    } finally {
      setMarking(false);
    }
    window.print();
  }

  async function undo() {
    if (!marked?.length) return;
    const { error: rpcError } = await supabase.rpc('unmark_vouchers_printed', { p_voucher_ids: marked });
    if (rpcError) setError(friendlyError(rpcError));
    else setUndone(true);
  }

  return (
    <div className="min-h-full bg-slate-200 pb-8 print:min-h-0 print:bg-white print:pb-0">
      <div className="no-print sticky top-0 z-10 bg-white/95 px-4 py-3 shadow">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <Link to="/vouchers/print" className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-slate-700 ring-1 ring-slate-300">
            ← Back
          </Link>
          <div className="flex-1 text-sm text-slate-700">
            {cards.isLoading ? (
              'Loading cards…'
            ) : (
              <>
                <strong>{formatNumber(list.length)}</strong> cards · {perPage} per page · <strong>{pages}</strong> A4 page{pages === 1 ? '' : 's'}
              </>
            )}
          </div>
          <Button onClick={handlePrint} disabled={marking || list.length === 0} className="min-h-12 px-6 text-lg">
            {marking && <Spinner />} Print
          </Button>
        </div>
        <div className="mx-auto max-w-5xl">
          {error && (
            <div className="mt-2">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
          {marked && !undone && (
            <div className="mt-2">
              <Alert tone="success">
                <span className="flex flex-wrap items-center gap-3">
                  <span>
                    {formatNumber(marked.length)} card{marked.length === 1 ? '' : 's'} marked as printed
                    {marked.length < list.length ? ` (${formatNumber(list.length - marked.length)} were printed before)` : ''}. In the print window choose A4,
                    scale 100%, no headers.
                  </span>
                  {marked.length > 0 && (
                    <button type="button" onClick={undo} className="font-semibold underline">
                      Printing failed or cancelled? Unmark these cards
                    </button>
                  )}
                </span>
              </Alert>
            </div>
          )}
          {undone && (
            <div className="mt-2">
              <Alert tone="info">The cards are marked as not printed again.</Alert>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto px-2 print:mt-0 print:overflow-visible print:p-0">
        {cards.isLoading && <Spinner className="mx-auto mt-10 block h-10 w-10 text-brand-600" />}
        {cards.error && (
          <div className="mx-auto max-w-xl">
            <Alert tone="error">{friendlyError(cards.error)}</Alert>
          </div>
        )}
        {cards.data && list.length === 0 && (
          <div className="mx-auto max-w-xl">
            <Alert tone="warning">No cards to print. Only vouchers that are already on the router can be printed.</Alert>
          </div>
        )}
        {list.length > 0 && <CardSheet cards={list} perPage={perPage} />}
      </div>
    </div>
  );
}
