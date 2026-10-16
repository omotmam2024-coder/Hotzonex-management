import { Link } from 'react-router-dom';

const UPDATED = '16 October 2026';
const CONTACT_PHONE = '+211 924 904 216';

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
  return (
    <div className="min-h-full bg-slate-50 px-4 py-8">
      <article className="mx-auto max-w-2xl space-y-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <header className="space-y-1">
          <img src="/logo.png" alt="Hotzonex WiFi" className="h-14 w-auto" />
          <h1 className="pt-2 text-2xl font-bold text-slate-900">Terms of service and privacy</h1>
          <p className="text-sm text-slate-500">Last updated {UPDATED}</p>
        </header>

        <Section title="1. The service">
          <p>
            Hotzonex Cloud is run by Hotzonex WiFi, Juba, South Sudan. It lets a WiFi business manage its MikroTik hotspot routers: make and sell
            vouchers, see sales and online users, and let customers buy cards. By creating an account or using the service, the business agrees to
            these terms.
          </p>
        </Section>

        <Section title="2. Free trial, price and payment">
          <p>
            New businesses get a free trial. After it, the service costs the monthly price per connected router shown on the Billing page.
            Hotzonex Cloud sends an invoice each month; it is paid in cash at our office or by mobile money, as the invoice says.
          </p>
          <p>
            If an invoice is still unpaid after its due day, the app is paused for that business until it is paid. The WiFi and the cards already
            on the routers keep working while the app is paused. Payments are not refunded for months already started. We tell businesses at least
            30 days before a price change.
          </p>
        </Section>

        <Section title="3. The business's responsibilities">
          <ul className="list-disc space-y-1 pl-5">
            <li>Keep logins private, give staff only the access they need, and switch off staff who leave.</li>
            <li>Own or be allowed to manage the routers added, and keep them powered and connected to the internet.</li>
            <li>Use the service lawfully, and follow the rules that apply to selling internet access where the business works.</li>
            <li>Check mobile-money payments before confirming them: Hotzonex Cloud does not receive or hold the business's money.</li>
          </ul>
        </Section>

        <Section title="4. Data we keep">
          <p>
            To run the service we keep: the business and site names, staff names, emails and phone numbers; plans, vouchers, sales and cash records;
            router addresses and login details (router passwords and tunnel keys are stored encrypted); who was online and for how long; and, for
            card purchases, the customer's phone number and transaction ID.
          </p>
          <p>
            Each business sees only its own data. We do not sell data or show advertising. The platform owner can open a business's account to help
            it (support), and each such visit is recorded. Data is stored with our hosting providers (Supabase, in the European Union, and
            DigitalOcean).
          </p>
          <p>
            A business can ask for a copy of its data, or for its account and data to be deleted, by contacting us. Sales records may be kept as long
            as the law requires.
          </p>
        </Section>

        <Section title="5. Availability and liability">
          <p>
            We work to keep Hotzonex Cloud running at all times, but cannot promise it will never be interrupted (for example by internet, power or
            provider outages). The service is provided as it is. As far as the law allows, Hotzonex WiFi is not responsible for lost income or
            indirect losses, and its total responsibility is limited to the fees the business paid in the last three months.
          </p>
        </Section>

        <Section title="6. Ending the service">
          <p>
            A business can stop at any time by telling us; it is not billed for later months. We may suspend or close an account that does not pay,
            breaks these terms, or puts other users at risk.
          </p>
        </Section>

        <Section title="7. Changes and contact">
          <p>
            We may update these terms; the date above shows the latest version, and important changes are announced in the app. Questions, data
            requests or complaints: call or WhatsApp <b>{CONTACT_PHONE}</b>, or visit our office in Juba.
          </p>
        </Section>

        <p className="border-t border-slate-100 pt-4 text-center text-sm">
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">
            Back to Hotzonex Cloud
          </Link>
        </p>
      </article>
    </div>
  );
}
