// OWNER: REVIEW AND EDIT. This is plain-language starter text, not legal advice. Have it checked by a
// lawyer in South Sudan before relying on it; change the contact details in lib/contact.ts.
import { Link } from 'react-router-dom';
import { CONTACT } from '../../lib/contact';
import { formatJubaDate } from '../../lib/format';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { useT } from '../../i18n';

const UPDATED = '16 October 2026';
const UPDATED_DAY = '2026-10-16';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <div className="space-y-2 text-slate-700">{children}</div>
    </section>
  );
}

/** Public: the terms of the Hotzonex Cloud service and how it handles data, in plain words. */
export function TermsPage() {
  const { t, lang } = useT();
  const [contactBefore, contactAfter = ''] = t('public.terms.s8.p1').split('{phone}');
  return (
    <div className="min-h-full bg-slate-50 px-4 py-8">
      <article className="mx-auto max-w-2xl space-y-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <div className="ms-auto max-w-xs">
          <LanguageSwitch tone="light" />
        </div>
        <header className="space-y-1">
          <img src="/logo.png" alt="Hotzonex WiFi" className="h-14 w-auto" />
          <h1 className="pt-2 text-2xl font-bold text-slate-900">{t('public.terms.title')}</h1>
          <p className="text-sm text-slate-500">{t('public.terms.updated', { date: lang === 'en' ? UPDATED : formatJubaDate(UPDATED_DAY) })}</p>
          {lang !== 'en' && <p className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">{t('public.terms.binding')}</p>}
        </header>

        <Section title={t('public.terms.s1.title')}>
          <p>{t('public.terms.s1.p1')}</p>
        </Section>

        <Section title={t('public.terms.s2.title')}>
          <p>{t('public.terms.s2.p1')}</p>
          <p>{t('public.terms.s2.p2')}</p>
        </Section>

        <Section title={t('public.terms.s3.title')}>
          <ul className="list-disc space-y-1 ps-5">
            <li>{t('public.terms.s3.li1')}</li>
            <li>{t('public.terms.s3.li2')}</li>
            <li>{t('public.terms.s3.li3')}</li>
            <li>{t('public.terms.s3.li4')}</li>
          </ul>
        </Section>

        <Section title={t('public.terms.s4.title')}>
          <p>{t('public.terms.s4.p1')}</p>
          <p>{t('public.terms.s4.p2')}</p>
          <p>{t('public.terms.s4.p3')}</p>
        </Section>

        <Section title={t('public.terms.s5.title')}>
          <p>{t('public.terms.s5.p1')}</p>
        </Section>

        <Section title={t('public.terms.s6.title')}>
          <p>{t('public.terms.s6.p1')}</p>
        </Section>

        <Section title={t('public.terms.s7.title')}>
          <p>{t('public.terms.s7.p1')}</p>
        </Section>

        <Section title={t('public.terms.s8.title')}>
          <p>
            {contactBefore}
            <b dir="ltr">{CONTACT.phone}</b>
            {contactAfter}
          </p>
          {CONTACT.email && (
            <p>
              {t('public.terms.email')}{' '}
              <a href={`mailto:${CONTACT.email}`} dir="ltr" className="font-semibold text-brand-700 hover:underline">
                {CONTACT.email}
              </a>
            </p>
          )}
        </Section>

        <p className="border-t border-slate-100 pt-4 text-center text-sm">
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">
            {t('public.terms.back')}
          </Link>
        </p>
      </article>
    </div>
  );
}
