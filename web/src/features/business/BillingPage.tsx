import { BillingPanel } from '../../components/BillingPanel';
import { PageHeader } from '../../components/PageHeader';
import { useT } from '../../i18n';

export function BillingPage() {
  const { t } = useT();
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.billing')} subtitle={t('business.billing.subtitle')} />
      <BillingPanel />
    </div>
  );
}
