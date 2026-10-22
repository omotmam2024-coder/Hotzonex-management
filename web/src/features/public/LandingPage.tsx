import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CONTACT, whatsappLink } from '../../lib/contact';
import { formatNumber, formatSSP, formatUsd } from '../../lib/format';
import { supabaseAnonKey, supabaseUrl } from '../../lib/supabase';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { translate, useT, type TKey } from '../../i18n';

interface PublicPlan {
  id: string;
  name: string;
  description: string;
  price_per_router_ssp: number | null;
  max_routers: number | null;
  max_sites: number | null;
  max_staff: number | null;
  max_vouchers_month: number | null;
}

interface Pricing {
  /** Pounds for one US dollar; null = no dollar prices shown. */
  usd_rate?: number | null;
  standard_price_per_router_ssp: number;
  trial_days: number;
  plans: PublicPlan[];
}

/** Shown until the live prices load, and if they cannot (the same values as the database). */
const DEFAULT_PRICING: Pricing = {
  standard_price_per_router_ssp: 120_000,
  trial_days: 14,
  plans: [
    { id: 'starter', name: 'Starter', description: 'One hotspot: one router, one site, a few cashiers.', price_per_router_ssp: null, max_routers: 1, max_sites: 1, max_staff: 3, max_vouchers_month: 5000 },
    { id: 'business', name: 'Business', description: 'Several sites and routers, cashiers and agents.', price_per_router_ssp: null, max_routers: 5, max_sites: 3, max_staff: 15, max_vouchers_month: 30000 },
    { id: 'pro', name: 'Pro', description: 'No limits: as many routers, sites, staff and vouchers as you need.', price_per_router_ssp: null, max_routers: null, max_sites: null, max_staff: null, max_vouchers_month: null },
  ],
};

/** The live plans and prices (no login needed); keeps the defaults as an offline fallback if they cannot load. */
function usePricing(): Pricing {
  const [pricing, setPricing] = useState(DEFAULT_PRICING);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    fetch(`${supabaseUrl}/rest/v1/rpc/public_pricing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
      body: '{}',
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<Pricing>) : null))
      .then((p) => {
        if (p && Array.isArray(p.plans) && p.plans.length) setPricing(p);
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return pricing;
}

const FEATURES: { title: TKey; text: TKey; icon: string }[] = [
  { icon: '⚡', title: 'public.landing.f1.title', text: 'public.landing.f1.text' },
  { icon: '🖨️', title: 'public.landing.f2.title', text: 'public.landing.f2.text' },
  { icon: '📡', title: 'public.landing.f3.title', text: 'public.landing.f3.text' },
  { icon: '👥', title: 'public.landing.f4.title', text: 'public.landing.f4.text' },
  { icon: '📊', title: 'public.landing.f5.title', text: 'public.landing.f5.text' },
  { icon: '🟢', title: 'public.landing.f6.title', text: 'public.landing.f6.text' },
  { icon: '📶', title: 'public.landing.f7.title', text: 'public.landing.f7.text' },
  { icon: '🔒', title: 'public.landing.f8.title', text: 'public.landing.f8.text' },
];

const FAQ: { q: TKey; a: TKey }[] = [
  { q: 'public.landing.q1', a: 'public.landing.a1' },
  { q: 'public.landing.q2', a: 'public.landing.a2' },
  { q: 'public.landing.q3', a: 'public.landing.a3' },
  { q: 'public.landing.q4', a: 'public.landing.a4' },
  { q: 'public.landing.q5', a: 'public.landing.a5' },
  { q: 'public.landing.q6', a: 'public.landing.a6' },
];

const SCREENS: { src: string; alt: TKey; caption: TKey }[] = [
  { src: '/screens/dashboard.png', alt: 'public.landing.screen1.alt', caption: 'public.landing.screen1.caption' },
  { src: '/screens/sell.png', alt: 'public.landing.screen2.alt', caption: 'public.landing.screen2.caption' },
  { src: '/screens/reports.png', alt: 'public.landing.screen3.alt', caption: 'public.landing.screen3.caption' },
];

function Section({ id, title, subtitle, children }: { id?: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-16 px-4 py-12 sm:py-16">
      <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h2>
      {subtitle && <p className="mx-auto mt-2 max-w-2xl text-center text-slate-600">{subtitle}</p>}
      <div className="mt-8">{children}</div>
    </section>
  );
}

const cta = 'inline-flex min-h-12 items-center justify-center rounded-xl px-6 text-lg font-semibold';

function limit(n: number | null, one: TKey, many: TKey, unlimited: TKey) {
  return n === null ? translate(unlimited) : translate(n === 1 ? one : many, { n: formatNumber(n) });
}

/** The default plans' descriptions in the chosen language; a description changed in the database is shown as written. */
const PLAN_TEXT: Record<string, TKey> = { starter: 'public.landing.plan.starter', business: 'public.landing.plan.business', pro: 'public.landing.plan.pro' };
function planDescription(p: PublicPlan): string {
  const key = PLAN_TEXT[p.id];
  const fallback = DEFAULT_PRICING.plans.find((d) => d.id === p.id)?.description;
  return key && p.description === fallback ? translate(key) : p.description;
}

/** The public page at "/": what Hotzonex Cloud is, prices, questions and how to reach us. */
export function LandingPage() {
  const pricing = usePricing();
  const { t } = useT();
  const demo = whatsappLink(t('public.landing.demoMessage'));

  return (
    <div className="min-h-full bg-white text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link to="/" className="flex min-h-11 items-center gap-2">
            <img src="/icon-72.png" alt="" className="h-9 w-9" />
            <span className="text-lg font-bold tracking-tight">Hotzonex Cloud</span>
          </Link>
          <nav className="flex items-center gap-2" aria-label={t('public.landing.navAccount')}>
            <div className="hidden w-56 md:block">
              <LanguageSwitch tone="light" />
            </div>
            <Link to="/login" className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-brand-700 hover:bg-brand-50">
              {t('public.login.logIn')}
            </Link>
            <Link to="/signup" className="hidden min-h-11 items-center rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 sm:inline-flex">
              {t('public.startTrial')}
            </Link>
          </nav>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-2 md:hidden">
          <div className="ms-auto max-w-xs">
            <LanguageSwitch tone="light" />
          </div>
        </div>
      </header>

      <main>
        <section className="bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 text-white">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-2">
            <div>
              <p className="mb-3 inline-block rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-brand-100">{t('public.landing.badge')}</p>
              <h1 className="text-3xl font-extrabold leading-tight sm:text-5xl">{t('public.landing.hero')}</h1>
              <p className="mt-4 text-lg text-white/85">{t('public.landing.heroText')}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/signup" className={`${cta} bg-white text-brand-800 hover:bg-brand-50`}>
                  {t('public.landing.trialCta', { days: pricing.trial_days })}
                </Link>
                <a href={demo} target="_blank" rel="noopener" className={`${cta} border-2 border-white/60 text-white hover:bg-white/10`}>
                  {t('public.landing.demoWhatsapp')}
                </a>
              </div>
              <p className="mt-3 text-sm text-white/70">{t('public.landing.noPayment')}</p>
            </div>
            <div className="mx-auto w-full max-w-xs overflow-hidden rounded-[2rem] border-8 border-slate-900 bg-slate-900 shadow-2xl">
              <img src={SCREENS[1]!.src} alt={t(SCREENS[1]!.alt)} className="w-full" width={390} height={844} />
            </div>
          </div>
        </section>

        <Section id="features" title={t('public.landing.featuresTitle')} subtitle={t('public.landing.featuresSubtitle')}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="text-3xl" aria-hidden="true">
                  {f.icon}
                </div>
                <h3 className="mt-3 text-lg font-bold">{t(f.title)}</h3>
                <p className="mt-1 text-slate-600">{t(f.text)}</p>
              </li>
            ))}
          </ul>
        </Section>

        <div className="bg-slate-50">
          <Section id="screens" title={t('public.landing.screensTitle')} subtitle={t('public.landing.screensSubtitle')}>
            <ul className="grid gap-6 sm:grid-cols-3">
              {SCREENS.map((s) => (
                <li key={s.src} className="text-center">
                  <div className="mx-auto max-w-[260px] overflow-hidden rounded-[1.6rem] border-[6px] border-slate-900 bg-slate-900 shadow-lg">
                    <img src={s.src} alt={t(s.alt)} loading="lazy" className="w-full" width={390} height={844} />
                  </div>
                  <p className="mt-3 font-medium text-slate-700">{t(s.caption)}</p>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section id="pricing" title={t('public.landing.pricingTitle')} subtitle={t('public.landing.pricingSubtitle', { days: pricing.trial_days })}>
          <ul className="grid gap-4 lg:grid-cols-3">
            {pricing.plans.map((p, i) => {
              const price = p.price_per_router_ssp ?? pricing.standard_price_per_router_ssp;
              return (
                <li key={p.id} className={`flex flex-col rounded-2xl border p-6 shadow-sm ${i === 1 ? 'border-brand-600 ring-2 ring-brand-600' : 'border-slate-200'}`}>
                  <h3 className="text-xl font-bold">{p.name}</h3>
                  <p className="mt-1 text-slate-600">{planDescription(p)}</p>
                  <p className="mt-4">
                    <span className="text-3xl font-extrabold">{formatSSP(price)}</span>
                    <span className="text-slate-600"> {t('public.landing.perRouter')}</span>
                    {formatUsd(price, pricing.usd_rate) && <span className="mt-1 block text-lg font-semibold text-slate-700">{formatUsd(price, pricing.usd_rate)}</span>}
                  </p>
                  <ul className="mt-4 flex-1 space-y-1 text-slate-700">
                    <li>✓ {limit(p.max_routers, 'public.landing.routerOne', 'public.landing.routerMany', 'public.landing.routerUnlimited')}</li>
                    <li>✓ {limit(p.max_sites, 'public.landing.siteOne', 'public.landing.siteMany', 'public.landing.siteUnlimited')}</li>
                    <li>✓ {limit(p.max_staff, 'public.landing.staffOne', 'public.landing.staffMany', 'public.landing.staffUnlimited')}</li>
                    <li>✓ {p.max_vouchers_month === null ? t('public.landing.vouchersUnlimited') : t('public.landing.vouchersMonth', { n: formatNumber(p.max_vouchers_month) })}</li>
                    <li>✓ {t('public.landing.extras')}</li>
                  </ul>
                  <Link to="/signup" className={`${cta} mt-6 ${i === 1 ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-brand-50 text-brand-800 hover:bg-brand-100'}`}>
                    {t('public.startTrial')}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-center text-sm text-slate-600">{t('public.landing.payNote')}</p>
        </Section>

        <div className="bg-slate-50">
          <Section id="faq" title={t('public.landing.faqTitle')}>
            <div className="mx-auto max-w-3xl space-y-3">
              {FAQ.map((f) => (
                <details key={f.q} className="group rounded-2xl border border-slate-200 bg-white p-4">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-lg font-semibold">
                    {t(f.q)}
                    <span className="text-brand-600 transition group-open:rotate-45" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p className="mt-2 text-slate-700">{t(f.a)}</p>
                </details>
              ))}
            </div>
          </Section>
        </div>

        <Section id="contact" title={t('public.landing.contactTitle')} subtitle={t('public.landing.contactSubtitle')}>
          <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
            <a href={demo} target="_blank" rel="noopener" className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 p-4 font-semibold hover:bg-slate-50">
              <span className="text-2xl" aria-hidden="true">
                💬
              </span>
              <span>
                WhatsApp <span dir="ltr">{CONTACT.phone}</span>
              </span>
            </a>
            <a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 p-4 font-semibold hover:bg-slate-50">
              <span className="text-2xl" aria-hidden="true">
                📞
              </span>
              <span>
                {t('public.landing.call')} <span dir="ltr">{CONTACT.phone}</span>
              </span>
            </a>
            {CONTACT.email && (
              <a href={`mailto:${CONTACT.email}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 p-4 font-semibold hover:bg-slate-50">
                <span className="text-2xl" aria-hidden="true">
                  ✉️
                </span>
                {CONTACT.email}
              </a>
            )}
            <div className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 p-4 font-semibold">
              <span className="text-2xl" aria-hidden="true">
                📍
              </span>
              {CONTACT.office}
            </div>
          </div>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/signup" className={`${cta} bg-brand-600 text-white hover:bg-brand-700`}>
              {t('public.startTrial')}
            </Link>
            <a href={demo} target="_blank" rel="noopener" className={`${cta} bg-brand-50 text-brand-800 hover:bg-brand-100`}>
              {t('public.landing.requestDemo')}
            </a>
          </div>
        </Section>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-slate-600 sm:flex-row">
          <span>{t('public.landing.copyright', { year: new Date().getFullYear() })}</span>
          <span className="flex gap-4">
            <Link to="/terms" className="inline-flex min-h-11 items-center hover:underline">
              {t('public.termsLink')}
            </Link>
            <Link to="/login" className="inline-flex min-h-11 items-center hover:underline">
              {t('public.login.subtitle')}
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
