import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { formatJubaTime, formatSSPWithUsd } from '../lib/format';
import { Alert } from './ui';
import { useT } from '../i18n';
import { useBillingOverview } from '../hooks/useBillingOverview';
import { daysLeft } from './BillingPanel';

/** For admins: the free trial's last days, or an invoice to pay. */
export function BillingBanner() {
  const { t } = useT();
  const { profile } = useAuth();
  const billing = useBillingOverview(profile?.role === 'admin');
  const b = billing.data;
  if (!b || b.exempt !== false) return null;
  const open = (b.invoices ?? []).find((i) => i.status === 'open' && !i.customer_ref);
  const left = daysLeft(b.trial_ends_at);
  let text: string | null = null;
  if (open) text = t('business.billing.bannerInvoice', { number: open.number, amount: formatSSPWithUsd(open.amount_ssp, b.usd_rate), date: formatJubaTime(open.due_at) });
  else if (b.status === 'trial' && left !== null && left <= 5) text = t(left === 1 ? 'business.billing.bannerTrialOne' : 'business.billing.bannerTrial', { n: left });
  if (!text) return null;
  return (
    <div className="mb-4 print:hidden">
      <Alert tone="warning">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{text}</span>
          <Link to="/billing" className="font-semibold underline">
            {t('nav.billing')}
          </Link>
        </div>
      </Alert>
    </div>
  );
}
