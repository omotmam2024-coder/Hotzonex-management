import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CONTACT, whatsappLink } from '../../lib/contact';
import { formatNumber } from '../../lib/format';
import { supabaseAnonKey, supabaseUrl } from '../../lib/supabase';

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

/** The live plans and prices (no login needed); keeps the defaults when offline or not set up yet. */
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

const FEATURES: { title: string; text: string; icon: string }[] = [
  { icon: '⚡', title: 'Sell a card in one tap', text: 'The cashier taps the plan; the code shows in big numbers, ready to print or send by WhatsApp.' },
  { icon: '🖨️', title: 'Print cards and receipts', text: 'A4 sheets of cards with your logo, and 58 mm or 80 mm receipts for small thermal printers.' },
  { icon: '📡', title: 'Works with your MikroTik', text: 'Connects to MikroTik routers (RouterOS 7) through a secure tunnel. Works with MikroTicket cards too.' },
  { icon: '👥', title: 'Cashiers and agents', text: 'Each seller has a login, a commission and a credit limit. The daily cash-up shows who holds what.' },
  { icon: '📊', title: 'Reports you can trust', text: 'Sales by day, week and month, by site, plan and seller. Download as a spreadsheet (CSV).' },
  { icon: '🟢', title: 'See everything live', text: 'Who is online, which router is down, cards running low. Alerts on your phone through Telegram.' },
  { icon: '📶', title: 'Made for slow internet', text: 'Light pages that work on cheap Android phones and weak connections. A lost connection never sells a card twice.' },
  { icon: '🔒', title: 'Safe and private', text: 'Every business sees only its own data. 2-step login, encrypted router passwords, a log of every sale and change.' },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'Which routers work?', a: 'MikroTik routers with RouterOS 7 and the hotspot set up. You paste one script on the router; Hotzonex does the rest.' },
  { q: 'I already use MikroTicket. Can I keep my cards?', a: 'Yes. Hotzonex reads the cards and profiles already on the router, counts their sales, and removes expired cards for you.' },
  { q: 'What happens when the internet goes down?', a: 'Your WiFi keeps working: the cards are on the router. Hotzonex catches up when the connection is back.' },
  { q: 'How do I pay for Hotzonex Cloud?', a: 'Each month you get an invoice. Pay in cash at our office, or by mobile money if you are far away.' },
  { q: 'Can I try it first?', a: 'Yes. Every new business starts with a free trial. No payment is needed to start.' },
  { q: 'Do customers need an app?', a: 'No. Customers type their code on the WiFi login page. Cashiers use Hotzonex in the phone browser.' },
];

const SCREENS: { src: string; alt: string; caption: string }[] = [
  { src: '/screens/dashboard.png', alt: 'Hotzonex dashboard with today’s sales, online users and router status', caption: 'Today’s sales, online users and routers at a glance' },
  { src: '/screens/sell.png', alt: 'A sold WiFi code shown in large numbers with Print and Share buttons', caption: 'Sell in one tap: big code, Print or Share' },
  { src: '/screens/reports.png', alt: 'Sales report with totals by plan and seller', caption: 'Reports by day, week and month' },
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

function limit(n: number | null, one: string, many: string) {
  return n === null ? `Unlimited ${many}` : `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** The public page at "/": what Hotzonex Cloud is, prices, questions and how to reach us. */
export function LandingPage() {
  const pricing = usePricing();
  const demo = whatsappLink('Hello Hotzonex Cloud, I run a WiFi hotspot and would like a demo.');

  return (
    <div className="min-h-full bg-white text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link to="/" className="flex min-h-11 items-center gap-2">
            <img src="/icon-72.png" alt="" className="h-9 w-9" />
            <span className="text-lg font-bold tracking-tight">Hotzonex Cloud</span>
          </Link>
          <nav className="flex items-center gap-2" aria-label="Account">
            <Link to="/login" className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-brand-700 hover:bg-brand-50">
              Log in
            </Link>
            <Link to="/signup" className="hidden min-h-11 items-center rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 sm:inline-flex">
              Start free trial
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 text-white">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-2">
            <div>
              <p className="mb-3 inline-block rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-brand-100">For WiFi hotspot businesses in South Sudan and East Africa</p>
              <h1 className="text-3xl font-extrabold leading-tight sm:text-5xl">Run your WiFi hotspot business from your phone</h1>
              <p className="mt-4 text-lg text-white/85">
                Make and sell MikroTik voucher cards, follow every SSP your cashiers and agents take, and see who is online — on any phone, even on slow
                internet.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/signup" className={`${cta} bg-white text-brand-800 hover:bg-brand-50`}>
                  Start {pricing.trial_days}-day free trial
                </Link>
                <a href={demo} target="_blank" rel="noopener" className={`${cta} border-2 border-white/60 text-white hover:bg-white/10`}>
                  Request a demo on WhatsApp
                </a>
              </div>
              <p className="mt-3 text-sm text-white/70">No payment needed to start.</p>
            </div>
            <div className="mx-auto w-full max-w-xs overflow-hidden rounded-[2rem] border-8 border-slate-900 bg-slate-900 shadow-2xl">
              <img src={SCREENS[1]!.src} alt={SCREENS[1]!.alt} className="w-full" width={390} height={844} />
            </div>
          </div>
        </section>

        <Section id="features" title="Everything a hotspot business needs" subtitle="One app for the owner, the cashiers and the agents.">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="text-3xl" aria-hidden="true">
                  {f.icon}
                </div>
                <h3 className="mt-3 text-lg font-bold">{f.title}</h3>
                <p className="mt-1 text-slate-600">{f.text}</p>
              </li>
            ))}
          </ul>
        </Section>

        <div className="bg-slate-50">
          <Section id="screens" title="See it on a phone" subtitle="This is what you and your cashiers use every day.">
            <ul className="grid gap-6 sm:grid-cols-3">
              {SCREENS.map((s) => (
                <li key={s.src} className="text-center">
                  <div className="mx-auto max-w-[260px] overflow-hidden rounded-[1.6rem] border-[6px] border-slate-900 bg-slate-900 shadow-lg">
                    <img src={s.src} alt={s.alt} loading="lazy" className="w-full" width={390} height={844} />
                  </div>
                  <p className="mt-3 font-medium text-slate-700">{s.caption}</p>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section id="pricing" title="Simple prices" subtitle={`Pay per connected router per month. Start with a ${pricing.trial_days}-day free trial.`}>
          <ul className="grid gap-4 lg:grid-cols-3">
            {pricing.plans.map((p, i) => {
              const price = p.price_per_router_ssp ?? pricing.standard_price_per_router_ssp;
              return (
                <li key={p.id} className={`flex flex-col rounded-2xl border p-6 shadow-sm ${i === 1 ? 'border-brand-600 ring-2 ring-brand-600' : 'border-slate-200'}`}>
                  <h3 className="text-xl font-bold">{p.name}</h3>
                  <p className="mt-1 text-slate-600">{p.description}</p>
                  <p className="mt-4">
                    <span className="text-3xl font-extrabold">{formatNumber(price)} SSP</span>
                    <span className="text-slate-600"> per router / month</span>
                  </p>
                  <ul className="mt-4 flex-1 space-y-1 text-slate-700">
                    <li>✓ {limit(p.max_routers, 'router', 'routers')}</li>
                    <li>✓ {limit(p.max_sites, 'site', 'sites')}</li>
                    <li>✓ {limit(p.max_staff, 'staff login', 'staff logins')}</li>
                    <li>✓ {p.max_vouchers_month === null ? 'Unlimited vouchers' : `${formatNumber(p.max_vouchers_month)} vouchers a month`}</li>
                    <li>✓ Reports, printing, alerts, support</li>
                  </ul>
                  <Link to="/signup" className={`${cta} mt-6 ${i === 1 ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-brand-50 text-brand-800 hover:bg-brand-100'}`}>
                    Start free trial
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-center text-sm text-slate-600">Pay in cash at our office, or by mobile money if you are far away.</p>
        </Section>

        <div className="bg-slate-50">
          <Section id="faq" title="Questions">
            <div className="mx-auto max-w-3xl space-y-3">
              {FAQ.map((f) => (
                <details key={f.q} className="group rounded-2xl border border-slate-200 bg-white p-4">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-lg font-semibold">
                    {f.q}
                    <span className="text-brand-600 transition group-open:rotate-45" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p className="mt-2 text-slate-700">{f.a}</p>
                </details>
              ))}
            </div>
          </Section>
        </div>

        <Section id="contact" title="Talk to us" subtitle="We set up your first router with you.">
          <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
            <a href={demo} target="_blank" rel="noopener" className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 p-4 font-semibold hover:bg-slate-50">
              <span className="text-2xl" aria-hidden="true">
                💬
              </span>
              WhatsApp {CONTACT.phone}
            </a>
            <a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 p-4 font-semibold hover:bg-slate-50">
              <span className="text-2xl" aria-hidden="true">
                📞
              </span>
              Call {CONTACT.phone}
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
              Start free trial
            </Link>
            <a href={demo} target="_blank" rel="noopener" className={`${cta} bg-brand-50 text-brand-800 hover:bg-brand-100`}>
              Request a demo
            </a>
          </div>
        </Section>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-slate-600 sm:flex-row">
          <span>© {new Date().getFullYear()} Hotzonex WiFi, Juba</span>
          <span className="flex gap-4">
            <Link to="/terms" className="inline-flex min-h-11 items-center hover:underline">
              Terms and privacy
            </Link>
            <Link to="/login" className="inline-flex min-h-11 items-center hover:underline">
              Staff login
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
