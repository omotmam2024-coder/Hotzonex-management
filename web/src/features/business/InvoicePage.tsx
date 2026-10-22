import { Link, useParams } from 'react-router-dom';
import { INVOICE_STATUS, PayForm } from '../../components/BillingPanel';
import { Alert, Badge, Button, buttonClass, Spinner } from '../../components/ui';
import { useBillingOverview } from '../../hooks/useBillingOverview';
import { CONTACT } from '../../lib/contact';
import { friendlyError } from '../../lib/errors';
import { formatJubaDate, formatSSP, formatUsd } from '../../lib/format';
import { useT } from '../../i18n';

/** One Hotzonex Cloud invoice as a document: read it, print it or save it as PDF, and pay it. */
export function InvoicePage() {
  const { t } = useT();
  const { id } = useParams();
  const billing = useBillingOverview();
  const b = billing.data;
  const inv = b?.invoices.find((i) => i.id === id);

  if (billing.error) return <Alert tone="error">{friendlyError(billing.error)}</Alert>;
  if (!b) return <Spinner />;
  if (!inv) return <Alert tone="warning">{t('business.bill.notFound')}</Alert>;
  const usd = (n: number) => formatUsd(n, b.usd_rate);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <style>{`@page { size: A4 portrait; margin: 14mm; }`}</style>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Link to="/billing" className={buttonClass('secondary')}>
          ← {t('nav.billing')}
        </Link>
        <Button onClick={() => window.print()}>{t('business.bill.print')}</Button>
      </div>

      <article className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-slate-200 sm:p-8 print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            <img src="/icon-192.png" alt="" className="h-12 w-12" />
            <div>
              <div className="text-xl font-extrabold text-slate-900">Hotzonex Cloud</div>
              <div className="text-xs text-slate-600">{CONTACT.office}</div>
              <div className="text-xs text-slate-600" dir="ltr">
                {CONTACT.phone}
                {CONTACT.email ? ` · ${CONTACT.email}` : ''}
              </div>
            </div>
          </div>
          <div className="sm:text-end">
            <div className="text-2xl font-extrabold tracking-wide text-slate-900">{t('business.bill.invoiceWord')}</div>
            <div className="font-mono text-sm text-slate-700" dir="ltr">
              {inv.number}
            </div>
            <div className="mt-1">
              <Badge color={INVOICE_STATUS[inv.status].color}>{t(INVOICE_STATUS[inv.status].key)}</Badge>
            </div>
          </div>
        </header>

        <section className="grid gap-4 py-5 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('business.bill.billTo')}</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{b.business_name ?? ''}</div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:justify-self-end">
            <dt className="text-slate-500">{t('business.bill.period')}</dt>
            <dd className="text-end font-medium">
              {formatJubaDate(inv.period_start)} – {formatJubaDate(inv.period_end)}
            </dd>
            <dt className="text-slate-500">{t('business.bill.due')}</dt>
            <dd className="text-end font-medium">{formatJubaDate(inv.due_at)}</dd>
            {inv.paid_at && (
              <>
                <dt className="text-slate-500">{t('business.bill.paidOn')}</dt>
                <dd className="text-end font-medium">{formatJubaDate(inv.paid_at)}</dd>
              </>
            )}
          </dl>
        </section>

        {/* Phone: one line of words; wider screens and print: the table. */}
        <div className="rounded-xl bg-slate-50 p-3 text-sm sm:hidden">
          <div className="font-semibold">
            {t('business.bill.line')}
            {b.plan_name ? ` · ${b.plan_name}` : ''}
          </div>
          <div className="mt-1 tabular-nums text-slate-700">
            {inv.routers} × {formatSSP(inv.price_per_router_ssp)} = <b>{formatSSP(inv.amount_ssp)}</b>
          </div>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-200 text-start text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pe-3 text-start font-semibold">{t('business.bill.item')}</th>
                <th className="px-3 py-2 text-end font-semibold">{t('business.bill.qty')}</th>
                <th className="px-3 py-2 text-end font-semibold">{t('business.bill.unit')}</th>
                <th className="py-2 ps-3 text-end font-semibold">{t('business.bill.amount')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-3 pe-3">
                  {t('business.bill.line')}
                  {b.plan_name ? ` · ${b.plan_name}` : ''}
                  <div className="text-xs text-slate-500">
                    {formatJubaDate(inv.period_start)} – {formatJubaDate(inv.period_end)}
                  </div>
                </td>
                <td className="px-3 py-3 text-end tabular-nums">{inv.routers}</td>
                <td className="px-3 py-3 text-end tabular-nums">{formatSSP(inv.price_per_router_ssp)}</td>
                <td className="py-3 ps-3 text-end tabular-nums">{formatSSP(inv.amount_ssp)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <div className="w-full max-w-xs rounded-xl bg-slate-50 p-4 print:bg-white print:ring-1 print:ring-slate-300">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-semibold text-slate-700">{t('business.bill.total')}</span>
              <span className="text-2xl font-extrabold tabular-nums text-slate-900">{formatSSP(inv.amount_ssp)}</span>
            </div>
            {usd(inv.amount_ssp) && <div className="mt-1 text-end text-sm text-slate-600">{usd(inv.amount_ssp)}</div>}
          </div>
        </div>

        {b.instructions && (
          <section className="mt-6 border-t border-slate-200 pt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('business.bill.howTitle')}</div>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{b.instructions}</p>
            <p className="mt-2 text-sm text-slate-600">{t('business.bill.reference', { number: inv.number })}</p>
          </section>
        )}
        <p className="mt-6 text-center text-xs text-slate-500">{t('business.bill.thanks')}</p>
      </article>

      {inv.status === 'open' && (
        <div className="print:hidden">
          <PayForm invoice={inv} />
        </div>
      )}
    </div>
  );
}
