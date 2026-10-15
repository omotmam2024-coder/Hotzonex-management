import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { formatJubaTime, formatNumber } from '../lib/format';
import { daysLeft, useBillingOverview } from './BillingPanel';

/** For admins: the free trial's last days, or an invoice to pay. */
export function BillingBanner() {
  const { profile } = useAuth();
  const billing = useBillingOverview(profile?.role === 'admin');
  const b = billing.data;
  if (!b || b.exempt !== false) return null;
  const open = (b.invoices ?? []).find((i) => i.status === 'open' && !i.customer_ref);
  const left = daysLeft(b.trial_ends_at);
  let text: string | null = null;
  if (open) text = `Invoice ${open.number}: ${formatNumber(open.amount_ssp)} SSP, due ${formatJubaTime(open.due_at)}.`;
  else if (b.status === 'trial' && left !== null && left <= 5) text = `Your free trial ends in ${left} day${left === 1 ? '' : 's'}.`;
  if (!text) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200 print:hidden">
      <span>{text}</span>
      <Link to="/billing" className="font-semibold underline">
        Billing
      </Link>
    </div>
  );
}
