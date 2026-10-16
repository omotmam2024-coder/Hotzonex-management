import { useCallback, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Spinner } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthProvider';
import { brandOf } from '../../print/brand';
import { Receipt, type ReceiptData, type ReceiptWidth } from '../../print/Receipt';

const WIDTH_KEY = 'hzc.receiptWidth';

function savedWidth(): ReceiptWidth {
  try {
    return window.localStorage.getItem(WIDTH_KEY) === '80' ? 80 : 58;
  } catch {
    return 58;
  }
}

/** Loads everything a receipt shows for one voucher (admins and managers). */
async function loadReceipt(voucherId: string): Promise<ReceiptData> {
  const { data: v, error } = await supabase
    .from('vouchers')
    .select('id, code, router_id, plan_id, site_id, on_router')
    .eq('id', voucherId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!v) throw new Error('Voucher not found.');
  if (!v.on_router) throw new Error('This voucher is not on the router yet, so it cannot be printed.');

  const [router, plan, site, sale] = await Promise.all([
    supabase.from('routers').select('dns_name').eq('id', v.router_id).single(),
    supabase.from('plans').select('name, color, price_ssp, uptime_seconds').eq('id', v.plan_id).single(),
    supabase.from('sites').select('name').eq('id', v.site_id).single(),
    supabase.from('sales').select('sold_at, seller_id, amount_ssp').eq('voucher_id', v.id).is('voided_at', null).maybeSingle(),
  ]);
  const err = router.error ?? plan.error ?? site.error ?? sale.error;
  if (err) throw new Error(err.message);
  if (!router.data || !plan.data || !site.data) throw new Error('Voucher details are missing.');

  let sellerName: string | null = null;
  if (sale.data?.seller_id) {
    const { data: seller } = await supabase.from('profiles').select('full_name').eq('id', sale.data.seller_id).maybeSingle();
    sellerName = seller?.full_name ?? null;
  } else if (sale.data) {
    sellerName = 'Automatic (first login)';
  }

  return {
    code: v.code,
    siteName: site.data.name,
    dnsName: router.data.dns_name ?? '',
    planName: plan.data.name,
    planColor: plan.data.color,
    priceSsp: sale.data?.amount_ssp ?? plan.data.price_ssp,
    uptimeSeconds: plan.data.uptime_seconds,
    soldAt: sale.data?.sold_at ?? null,
    sellerName,
  };
}

/**
 * Thermal receipt for one voucher. The Sell screen passes the receipt data in
 * navigation state (sellers cannot read vouchers directly); otherwise it is loaded by id.
 */
export function PrintReceiptPage() {
  const { voucherId } = useParams<{ voucherId: string }>();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const passed = (location.state as { receipt?: ReceiptData } | null)?.receipt;
  const [width, setWidth] = useState<ReceiptWidth>(savedWidth);
  const printedOnce = useRef(false);
  const { business } = useAuth();

  const receipt = useQuery({
    queryKey: ['receipt', voucherId],
    enabled: !passed && Boolean(voucherId),
    queryFn: () => loadReceipt(voucherId ?? ''),
  });
  const data = passed ?? receipt.data;

  function chooseWidth(w: ReceiptWidth) {
    setWidth(w);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // Remembering the width is only a convenience.
    }
  }

  // ?print=1 opens the print window as soon as the receipt (with its logo) is ready.
  const autoPrint = params.get('print') === '1';
  const onReady = useCallback(() => {
    if (autoPrint && !printedOnce.current) {
      printedOnce.current = true;
      setTimeout(() => window.print(), 300);
    }
  }, [autoPrint]);

  return (
    <div className="min-h-full bg-slate-200 pb-8 print:min-h-0 print:bg-white print:pb-0">
      <div className="no-print sticky top-0 z-10 bg-white/95 px-4 py-3 shadow">
        <div className="mx-auto flex max-w-xl flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            ← Back
          </Button>
          <div className="flex flex-1 justify-center gap-1">
            {([58, 80] as ReceiptWidth[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => chooseWidth(w)}
                className={`min-h-11 rounded-xl px-4 font-semibold ring-1 ${width === w ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'}`}
              >
                {w} mm
              </button>
            ))}
          </div>
          <Button onClick={() => window.print()} disabled={!data} className="min-h-12 px-6 text-lg">
            Print receipt
          </Button>
        </div>
      </div>
      <div className="mt-4 print:mt-0">
        {receipt.isLoading && <Spinner className="mx-auto mt-10 block h-10 w-10 text-brand-600" />}
        {receipt.error && (
          <div className="mx-auto max-w-md px-4">
            <Alert tone="error">{friendlyError(receipt.error)}</Alert>
          </div>
        )}
        {data && <Receipt data={data} width={width} brand={brandOf(business)} onReady={onReady} />}
      </div>
    </div>
  );
}
