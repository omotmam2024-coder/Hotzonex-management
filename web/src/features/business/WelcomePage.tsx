import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Button, Card, Field, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { useT } from '../../i18n';
import { translate } from '../../i18n/translate';
import { useSites } from '../../hooks/queries';
import { useSetupProgress } from '../../hooks/useSetupProgress';
import { supabase } from '../../lib/supabase';
import { validate } from '../../lib/validation';
import { BusinessSettingsForm } from './BusinessSettingsPage';

const STEP_KEY = 'hzc.welcomeBusinessDone';

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  const { t } = useT();
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
          {done && <span className="sr-only"> {t('business.welcome.doneSr')}</span>}
        </h2>
      </div>
      {children}
    </Card>
  );
}

const siteNameSchema = () => z.string().trim().min(1, translate('business.welcome.errSiteName')).max(80, translate('msg.siteNameLong'));

function SiteStep({ done }: { done: boolean }) {
  const { t } = useT();
  const sites = useSites();
  const queryClient = useQueryClient();
  const site = sites.data?.[0];
  const [name, setName] = useState(site?.name ?? '');
  useEffect(() => {
    if (site?.name) setName(site.name);
  }, [site?.name]);
  const save = useMutation({
    mutationFn: async () => {
      if (!site) throw new Error(t('business.welcome.errNoSite'));
      const { error } = await supabase.from('sites').update({ name: validate(siteNameSchema(), name) }).eq('id', site.id);
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sites'] }),
  });
  return (
    <Step n={2} title={t('business.welcome.step2')} done={done}>
      <p className="text-slate-700">{t('business.welcome.step2Text')}</p>
      {site && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Field label={t('business.welcome.siteName')}>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
          </div>
          <Button variant="secondary" onClick={() => save.mutate()} disabled={save.isPending || name.trim() === site.name}>
            {save.isPending && <Spinner />} {t('business.welcome.saveName')}
          </Button>
        </div>
      )}
      {save.isSuccess && <Alert tone="success">{t('business.welcome.siteSaved')}</Alert>}
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
    </Step>
  );
}

/** First steps after sign-up: business details, site, router, plan, then the first cards. */
export function WelcomePage() {
  const { t } = useT();
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
      <PageHeader title={t('business.welcome.title')} subtitle={t('business.welcome.subtitle')} />
      {progress.loading && <Spinner className="h-6 w-6 text-brand-600" />}

      <Step n={1} title={t('business.welcome.step1')} done={businessDone}>
        {businessDone ? (
          <p className="text-slate-700">
            {t('business.welcome.step1Done')}{' '}
            <Link to="/business" className="font-semibold text-brand-700 underline">
              {t('nav.business')}
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-slate-700">{t('business.welcome.step1Text')}</p>
            <BusinessSettingsForm onSaved={markBusinessDone} saveLabel={t('business.welcome.saveContinue')} />
            <button type="button" onClick={markBusinessDone} className="min-h-11 text-sm font-semibold text-brand-700 underline">
              {t('business.welcome.skip')}
            </button>
          </>
        )}
      </Step>

      <SiteStep done={progress.hasSite} />

      <Step n={3} title={t('business.welcome.step3')} done={progress.hasRouter}>
        <p className="text-slate-700">
          {progress.hasRouter
            ? progress.routerOnline
              ? t('business.welcome.routerOnline')
              : t('business.welcome.routerAdded')
            : t('business.welcome.routerNone')}
        </p>
        <Link to={progress.hasRouter ? '/routers' : '/routers/new'} className="inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
          {progress.hasRouter ? t('business.welcome.openRouters') : t('business.welcome.addRouter')}
        </Link>
      </Step>

      <Step n={4} title={t('business.welcome.step4')} done={progress.hasPlan}>
        <p className="text-slate-700">{t('business.welcome.step4Text')}</p>
        <Link to="/plans" className="inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
          {progress.hasPlan ? t('business.welcome.openPlans') : t('business.welcome.makePlan')}
        </Link>
      </Step>

      <Step n={5} title={t('business.welcome.step5')} done={false}>
        <p className="text-slate-700">{t('business.welcome.step5Text')}</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/vouchers/generate" className="inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
            {t('business.welcome.generate')}
          </Link>
          <Link to="/sell" className="inline-flex min-h-12 items-center rounded-xl bg-brand-50 px-5 font-semibold text-brand-800 hover:bg-brand-100">
            {t('business.welcome.openSell')}
          </Link>
        </div>
      </Step>

      {allDone && <Alert tone="success">{t('business.welcome.allDone')}</Alert>}
      <Link to="/dashboard" className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline">
        {t('business.welcome.goDashboard')}
      </Link>
    </div>
  );
}
