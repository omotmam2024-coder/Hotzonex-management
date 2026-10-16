import { BillingPanel } from '../../components/BillingPanel';
import { PageHeader } from '../../components/PageHeader';

export function BillingPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Billing" subtitle="Your Hotzonex Cloud plan and invoices" />
      <BillingPanel />
    </div>
  );
}
