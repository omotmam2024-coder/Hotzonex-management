import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Button, Card, Field, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { useSites } from '../../hooks/queries';
import { useSetupProgress } from '../../hooks/useSetupProgress';
import { supabase } from '../../lib/supabase';
import { validate } from '../../lib/validation';
import { BusinessSettingsForm } from './BusinessSettingsPage';

const STEP_KEY = 'hzc.welcomeBusinessDone';

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold ${done ? 'bg-emerald-600 text-white' : 'bg-brand-50 text-brand-700'}`}
          aria-hidden="true"
        >
          {done ? '✓' : n}
        </span>
        <h2 className="text-lg font-bold">
          {title}
          {done && <span className="sr-only"> (done)</span>}
        </h2>
      </div>
      {children}
    </Card>
  );
}

const siteNameSchema = z.string().trim().min(1, 'Type the site name.').max(80, 'The site name is too long (max 80 characters).');

function SiteStep({ done }: { done: boolean }) {
  const sites = useSites();
  const queryClient = useQueryClient();
  const site = sites.data?.[0];
  const [name, setName] = useState(site?.name ?? '');
  useEffect(() => {
    if (site?.name) setName(site.name);
  }, [site?.name]);
  const save = useMutation({
    mutationFn: async () => {
      if (!site) throw new Error('No site yet. Add one on the Routers page.');
      const { error } = await supabase.from('sites').update({ name: validate(siteNameSchema, name) }).eq('id', site.id);
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sites'] }),
  });
  return (
    <Step n={2} title="Your first site" done={done}>
      <p className="text-slate-700">A site is a place where you sell WiFi (a shop, a market, a school). You can add more sites later on the Routers page.</p>
      {site && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Field label="Site name">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
          </div>
          <Button variant="secondary" onClick={() => save.mutate()} disabled={save.isPending || name.trim() === site.name}>
            {save.isPending && <Spinner />} Save name
          </Button>
        </div>
      )}
      {save.isSuccess && <Alert tone="success">Site name saved.</Alert>}
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
    </Step>
  );
}

/** First steps after sign-up: business details, site, router, plan, then the first cards. */
export function WelcomePage() {
  const progress = useSetupProgress();
  const [businessDone, setBusinessDone] = useState(() => {
    try {
      return window.localStorage.getItem(STEP_KEY) === '1';
    } catch {
      return false;
    }
  });
  const markBusinessDone = () => {
    setBusinessDone(true);
    try {
      window.localStorage.setItem(STEP_KEY, '1');
    } catch {
      // Private mode: the step simply shows again next time.
    }
  };
  const allDone = businessDone && progress.hasSite && progress.hasRouter && progress.hasPlan;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Welcome to Hotzonex Cloud" subtitle="Five short steps and you are selling WiFi cards." />
      {progress.loading && <Spinner className="h-6 w-6 text-brand-600" />}

      <Step n={1} title="Your business" done={businessDone}>
        {businessDone ? (
          <p className="text-slate-700">
            Done. Change it any time in{' '}
            <Link to="/business" className="font-semibold text-brand-700 underline">
              Business settings
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-slate-700">Your name and logo are printed on cards and receipts. The dollar rate shows USD next to SSP.</p>
            <BusinessSettingsForm onSaved={markBusinessDone} saveLabel="Save and continue" />
            <button type="button" onClick={markBusinessDone} className="min-h-11 text-sm font-semibold text-brand-700 underline">
              Skip for now
            </button>
          </>
        )}
      </Step>

      <SiteStep done={progress.hasSite} />

      <Step n={3} title="Connect your MikroTik router" done={progress.hasRouter}>
        <p className="text-slate-700">
          {progress.hasRouter
            ? progress.routerOnline
              ? 'Your router is connected and online.'
              : 'Your router is added. Paste the tunnel script on it (Routers page) so it comes online.'
            : 'Type the router’s address, username and password. Hotzonex then gives you one script to paste on the router.'}
        </p>
        <Link to={progress.hasRouter ? '/routers' : '/routers/new'} className="inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
          {progress.hasRouter ? 'Open routers' : 'Add my router'}
        </Link>
      </Step>

      <Step n={4} title="Make your first plan" done={progress.hasPlan}>
        <p className="text-slate-700">A plan is what you sell: for example “1 hour – 1,000 SSP”. Already using MikroTicket? Its profiles show up as plans to choose.</p>
        <Link to="/plans" className="inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
          {progress.hasPlan ? 'Open plans' : 'Make a plan'}
        </Link>
      </Step>

      <Step n={5} title="Make cards and sell" done={false}>
        <p className="text-slate-700">Generate a batch of cards for a plan. Then sell them on the Sell page, or print them on A4 sheets.</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/vouchers/generate" className="inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
            Generate cards
          </Link>
          <Link to="/sell" className="inline-flex min-h-12 items-center rounded-xl bg-brand-50 px-5 font-semibold text-brand-800 hover:bg-brand-100">
            Open Sell
          </Link>
        </div>
      </Step>

      {allDone && <Alert tone="success">Your business is set up. Add cashiers and agents on the Staff page when you are ready.</Alert>}
      <Link to="/dashboard" className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline">
        Go to the dashboard
      </Link>
    </div>
  );
}
