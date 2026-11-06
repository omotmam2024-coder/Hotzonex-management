import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CONTACT, whatsappLink } from '../../lib/contact';
import { formatNumber, formatSSP, formatUsd } from '../../lib/format';
import { supabaseAnonKey, supabaseUrl } from '../../lib/supabase';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { translate, useT, type TKey } from '../../i18n';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../lib/nav';

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

const FEATURES: { title: TKey; text: TKey; icon: IconName }[] = [
  { icon: 'sell', title: 'public.landing.f1.title', text: 'public.landing.f1.text' },
  { icon: 'vouchers', title: 'public.landing.f2.title', text: 'public.landing.f2.text' },
  { icon: 'routers', title: 'public.landing.f3.title', text: 'public.landing.f3.text' },
  { icon: 'staff', title: 'public.landing.f4.title', text: 'public.landing.f4.text' },
  { icon: 'reports', title: 'public.landing.f5.title', text: 'public.landing.f5.text' },
  { icon: 'alerts', title: 'public.landing.f6.title', text: 'public.landing.f6.text' },
  { icon: 'portal', title: 'public.landing.f7.title', text: 'public.landing.f7.text' },
  { icon: 'security', title: 'public.landing.f8.title', text: 'public.landing.f8.text' },
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

/** A section of the landing page: heading on the left, content beside it on wide screens and below on phones. */
function Section({ id, title, subtitle, children, tone = 'paper' }: { id?: string; title: string; subtitle?: string; children: ReactNode; tone?: 'paper' | 'white' }) {
  return (
    <section id={id} className={`scroll-mt-16 ${tone === 'white' ? 'bg-white' : 'bg-[#f4f6fa]'}`}>
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 sm:py-24 lg:grid-cols-[18rem_1fr] lg:gap-16">
        <div>
          <h2 className="text-[34px] font-extrabold leading-[1.02] text-brand-950 sm:text-[44px]">{title}</h2>
          {subtitle && <p className="mt-3 max-w-sm text-lg text-slate-600">{subtitle}</p>}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

const cta = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-6 py-2 text-lg font-bold transition active:scale-[0.98] sm:whitespace-nowrap';

/** The cards fanned out in the hero: what every hotspot business prints and sells, every day. */
const DEMO_CARDS = [
  { price: 1000, code: '4281 242', band: 'bg-brand-600' },
  { price: 5000, code: '7093 518', band: 'bg-accent-600' },
  { price: 25000, code: '3160 874', band: 'bg-emerald-700' },
];

function VoucherCard({ price, code, band, className = '' }: { price: number; code: string; band: string; className?: string }) {
  return (
    <div className={`voucher flex h-[9.5rem] w-[19rem] overflow-hidden rounded-lg bg-white text-brand-950 shadow-lift sm:h-44 sm:w-[22rem] ${className}`} dir="ltr">
      {/* The stub, torn off at the dashed line. */}
      <div className={`flex w-14 shrink-0 flex-col items-center justify-between py-3 text-white sm:w-16 ${band}`}>
        <img src="/icon-72.png" alt="" className="h-7 w-7 rounded-full bg-white p-0.5" />
        <span className="num-display text-[13px] font-bold [writing-mode:vertical-rl] rotate-180">{formatSSP(price)}</span>
      </div>
      <div className="voucher-perf w-0 border-s-2 border-dashed border-slate-300" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col justify-between p-4 sm:p-5">
        <div className="flex items-center justify-between text-sm font-bold text-slate-500">
          <span>Hotzonex WiFi</span>
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-600" fill="currentColor" aria-hidden="true">
            <path d="M12 18.5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5zM4.22 9.22a11 11 0 0 1 15.56 0l-1.41 1.41a9 9 0 0 0-12.74 0L4.22 9.22zm2.83 2.83a7 7 0 0 1 9.9 0l-1.42 1.42a5 5 0 0 0-7.06 0l-1.42-1.42z" />
          </svg>
        </div>
        <div className="num-display text-[46px] font-extrabold leading-none sm:text-[54px]">{code}</div>
        <div className="h-1.5 w-16 rounded-full bg-slate-200" aria-hidden="true" />
      </div>
    </div>
  );
}

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
    <div className="min-h-full bg-[#f4f6fa] text-slate-900">
      <style>{`
        .voucher-perf { position: relative; }
        .voucher-perf::before, .voucher-perf::after {
          content: ''; position: absolute; left: -9px; width: 16px; height: 16px; border-radius: 9999px; background: #0a1b4d;
        }
        .voucher-perf::before { top: -8px; }
        .voucher-perf::after { bottom: -8px; }
        @keyframes fan-in { from { transform: translate(0, 0) rotate(-2deg); } }
        .fan > * { position: relative; animation: fan-in 900ms cubic-bezier(.2,.8,.2,1) 250ms backwards; }
        .fan-back { z-index: 1; transform: translate(2.5rem, -3.25rem) rotate(8deg); }
        .fan-mid { z-index: 2; transform: translate(1rem, -1.25rem) rotate(2deg); }
        .fan-top { z-index: 3; transform: translate(-1.25rem, 1.75rem) rotate(-6deg); }
        @media (prefers-reduced-motion: reduce) { .fan > * { animation: none; } }
      `}</style>

      <header className="sticky top-0 z-20 bg-brand-950/95 text-white backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5">
          <Link to="/" className="flex min-h-11 items-center gap-2.5">
            <img src="/icon-72.png" alt="" className="h-9 w-9" />
            <span className="font-display text-xl font-extrabold tracking-tight [font-stretch:88%]">Hotzonex Cloud</span>
          </Link>
          <nav className="flex items-center gap-2" aria-label={t('public.landing.navAccount')}>
            <div className="hidden w-60 md:block">
              <LanguageSwitch tone="dark" />
            </div>
            <Link to="/login" className="inline-flex min-h-11 items-center rounded-lg px-3 font-bold text-white/85 hover:bg-white/10 hover:text-white">
              {t('public.login.logIn')}
            </Link>
            <Link to="/signup" className="hidden min-h-11 items-center rounded-lg bg-accent-600 px-4 font-bold text-white hover:bg-accent-700 sm:inline-flex">
              {t('public.startTrial')}
            </Link>
          </nav>
        </div>
        <div className="mx-auto max-w-6xl px-5 pb-2 md:hidden">
          <LanguageSwitch tone="dark" />
        </div>
      </header>

      <main>
        <section className="overflow-hidden bg-brand-950 text-white">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-10 sm:pt-16 lg:grid-cols-[1.15fr_1fr] lg:pb-28 lg:pt-20">
            <div>
              <p className="max-w-md text-[15px] font-bold text-accent-300">{t('public.landing.badge')}</p>
              <h1 className="mt-5 text-[46px] font-extrabold leading-[0.95] [font-stretch:80%] sm:text-[68px] lg:text-[80px]">{t('public.landing.hero')}</h1>
              <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-white/80">{t('public.landing.heroText')}</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link to="/signup" className={`${cta} bg-accent-600 text-white hover:bg-accent-500`}>
                  {t('public.landing.trialCta', { days: pricing.trial_days })}
                </Link>
                <a href={demo} target="_blank" rel="noopener" className={`${cta} text-white ring-2 ring-inset ring-white/30 hover:bg-white/10 hover:ring-white/60`}>
                  <Icon name="whatsapp" className="h-5 w-5 text-[#25D366]" />
                  {t('public.landing.demoWhatsapp')}
                </a>
              </div>
              <p className="mt-4 text-sm text-white/60">{t('public.landing.noPayment')}</p>
            </div>

            <div className="relative mx-auto h-[18rem] w-full max-w-[26rem] sm:h-[22rem]" role="img" aria-label={t('public.landing.screen2.alt')}>
              <div className="fan absolute inset-0 grid place-items-center [&>*]:col-start-1 [&>*]:row-start-1">
                <VoucherCard {...DEMO_CARDS[2]!} className="fan-back" />
                <VoucherCard {...DEMO_CARDS[1]!} className="fan-mid" />
                <VoucherCard {...DEMO_CARDS[0]!} className="fan-top" />
              </div>
            </div>
          </div>
        </section>

        <Section id="features" title={t('public.landing.featuresTitle')} subtitle={t('public.landing.featuresSubtitle')}>
          <ul className="grid gap-x-10 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-4 border-t border-slate-300/70 py-6">
                <Icon name={f.icon} className="mt-0.5 h-6 w-6 shrink-0 text-brand-600" />
                <div>
                  <h3 className="text-xl font-bold text-brand-950">{t(f.title)}</h3>
                  <p className="mt-1.5 leading-relaxed text-slate-600">{t(f.text)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="screens" tone="white" title={t('public.landing.screensTitle')} subtitle={t('public.landing.screensSubtitle')}>
          <ul className="-mx-5 flex snap-x snap-mandatory gap-6 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
            {SCREENS.map((s) => (
              <li key={s.src} className="w-[15rem] shrink-0 snap-start sm:w-auto">
                <div className="overflow-hidden rounded-[1.6rem] border-[6px] border-brand-950 bg-brand-950">
                  <img src={s.src} alt={t(s.alt)} loading="lazy" className="w-full" width={390} height={844} />
                </div>
                <p className="mt-4 font-bold text-slate-700">{t(s.caption)}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="pricing" title={t('public.landing.pricingTitle')} subtitle={t('public.landing.pricingSubtitle', { days: pricing.trial_days })}>
          <ul className="grid overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 lg:grid-cols-3">
            {pricing.plans.map((p, i) => {
              const price = p.price_per_router_ssp ?? pricing.standard_price_per_router_ssp;
              const featured = i === 1;
              return (
                <li key={p.id} className={`relative flex flex-col p-6 sm:p-7 ${i > 0 ? 'border-t border-slate-200 lg:border-s lg:border-t-0' : ''}`}>
                  {featured && <span className="absolute inset-x-0 top-0 h-1 bg-accent-600" aria-hidden="true" />}
                  <h3 className="text-2xl font-extrabold text-brand-950">{p.name}</h3>
                  <p className="mt-1 text-slate-600 lg:min-h-[4.5rem]">{planDescription(p)}</p>
                  <p className="mt-5">
                    <span className="num-display block text-[40px] font-extrabold leading-none text-brand-950">{formatSSP(price)}</span>
                    <span className="mt-1.5 block text-slate-600">{t('public.landing.perRouter')}</span>
                    {formatUsd(price, pricing.usd_rate) && <span className="block font-bold text-slate-800">{formatUsd(price, pricing.usd_rate)}</span>}
                  </p>
                  <ul className="mt-6 flex-1 space-y-2 text-slate-700">
                    {[
                      limit(p.max_routers, 'public.landing.routerOne', 'public.landing.routerMany', 'public.landing.routerUnlimited'),
                      limit(p.max_sites, 'public.landing.siteOne', 'public.landing.siteMany', 'public.landing.siteUnlimited'),
                      limit(p.max_staff, 'public.landing.staffOne', 'public.landing.staffMany', 'public.landing.staffUnlimited'),
                      p.max_vouchers_month === null ? t('public.landing.vouchersUnlimited') : t('public.landing.vouchersMonth', { n: formatNumber(p.max_vouchers_month) }),
                      t('public.landing.extras'),
                    ].map((line) => (
                      <li key={line} className="flex gap-2.5">
                        <svg viewBox="0 0 20 20" className="mt-1 h-4 w-4 shrink-0 text-emerald-700" fill="currentColor" aria-hidden="true">
                          <path d="M7.6 13.2 4.4 10l-1.4 1.4 4.6 4.6 9.4-9.4L15.6 5.2z" />
                        </svg>
                        {line}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/signup"
                    className={`${cta} mt-7 ${featured ? 'bg-accent-600 text-white hover:bg-accent-700' : 'text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50'}`}
                  >
                    {t('public.startTrial')}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-slate-600">{t('public.landing.payNote')}</p>
        </Section>

        <Section id="faq" tone="white" title={t('public.landing.faqTitle')}>
          <div className="max-w-3xl border-b border-slate-200">
            {FAQ.map((f) => (
              <details key={f.q} className="group border-t border-slate-200">
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-3 text-lg font-bold text-brand-950 [&::-webkit-details-marker]:hidden">
                  {t(f.q)}
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-brand-600 ring-1 ring-brand-200 transition group-open:rotate-45" aria-hidden="true">
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                      <path d="M9 4h2v5h5v2h-5v5H9v-5H4V9h5z" />
                    </svg>
                  </span>
                </summary>
                <p className="max-w-2xl pb-5 leading-relaxed text-slate-700">{t(f.a)}</p>
              </details>
            ))}
          </div>
        </Section>

        <section id="contact" className="scroll-mt-16 bg-brand-950 text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:py-24 lg:grid-cols-[18rem_1fr] lg:gap-16">
            <div>
              <h2 className="text-[34px] font-extrabold leading-[1.02] sm:text-[44px]">{t('public.landing.contactTitle')}</h2>
              <p className="mt-3 text-lg text-white/75">{t('public.landing.contactSubtitle')}</p>
            </div>
            <div>
              <ul className="grid gap-x-10 text-lg sm:grid-cols-2">
                <li className="border-t border-white/15">
                  <a href={demo} target="_blank" rel="noopener" className="flex min-h-16 items-center gap-3 font-bold hover:text-accent-300">
                    <Icon name="whatsapp" className="h-6 w-6 shrink-0 text-[#25D366]" />
                    <span>
                      WhatsApp <span dir="ltr">{CONTACT.phone}</span>
                    </span>
                  </a>
                </li>
                <li className="border-t border-white/15">
                  <a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`} className="flex min-h-16 items-center gap-3 font-bold hover:text-accent-300">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-white/60" fill="currentColor" aria-hidden="true">
                      <path d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8z" />
                    </svg>
                    <span>
                      {t('public.landing.call')} <span dir="ltr">{CONTACT.phone}</span>
                    </span>
                  </a>
                </li>
                {CONTACT.email && (
                  <li className="border-t border-white/15">
                    <a href={`mailto:${CONTACT.email}`} className="flex min-h-16 items-center gap-3 font-bold hover:text-accent-300">
                      <Icon name="mail" className="h-6 w-6 shrink-0 text-white/60" />
                      <span dir="ltr">{CONTACT.email}</span>
                    </a>
                  </li>
                )}
                <li className="flex min-h-16 items-center gap-3 border-t border-white/15 text-white/80">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-white/60" fill="currentColor" aria-hidden="true">
                    <path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
                  </svg>
                  {CONTACT.office}
                </li>
              </ul>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Link to="/signup" className={`${cta} bg-accent-600 text-white hover:bg-accent-500`}>
                  {t('public.startTrial')}
                </Link>
                <a href={demo} target="_blank" rel="noopener" className={`${cta} text-white ring-2 ring-inset ring-white/30 hover:bg-white/10 hover:ring-white/60`}>
                  {t('public.landing.requestDemo')}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-brand-950 text-white/60">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-3 px-5 py-6 text-sm sm:flex-row sm:items-center">
          <span>
            {t('public.landing.copyright', { year: new Date().getFullYear() })}
            {/* The brand's own line from the logo; kept in English in every language, like the name. */}
            <span className="ms-4 inline-block font-bold text-white/80" dir="ltr">
              Design <span className="text-accent-500">|</span> Print <span className="text-accent-500">|</span> Brand <span className="text-accent-500">|</span> Connect
            </span>
          </span>
          <span className="flex gap-5">
            <Link to="/terms" className="inline-flex min-h-11 items-center hover:text-white">
              {t('public.termsLink')}
            </Link>
            <Link to="/login" className="inline-flex min-h-11 items-center hover:text-white">
              {t('public.login.subtitle')}
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
