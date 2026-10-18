import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, buttonClass, Card, Spinner, TextInput } from '../../components/ui';
import { TotpQr } from '../../components/TotpQr';
import { friendlyError } from '../../lib/errors';
import { useT } from '../../i18n';
import { supabase } from '../../lib/supabase';

interface Enrolment {
  factorId: string;
  uri: string;
  secret: string;
}

/** Each person's own login security: the 2-step login (authenticator app) and logging out everywhere. */
export function SecurityPage() {
  const { t } = useT();
  const { isPlatformAdmin, twoStep, reload, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);
  async function copyKey() {
    if (!enrolment) return;
    try {
      await navigator.clipboard.writeText(enrolment.secret);
      setKeyCopied(true);
    } catch {
      /* copying blocked: the key can still be selected and typed */
    }
  }

  const factors = useQuery({
    queryKey: ['mfa-factors'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw new Error(friendlyError(error));
      return data;
    },
  });
  const verified = factors.data?.totp.find((f) => f.status === 'verified') ?? null;

  const start = useMutation({
    mutationFn: async (): Promise<Enrolment> => {
      // An unfinished earlier attempt is cleared first.
      for (const f of factors.data?.all ?? []) {
        if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Hotzonex ${new Date().toISOString().slice(0, 10)}` });
      if (error) throw new Error(friendlyError(error));
      return { factorId: data.id, uri: data.totp.uri, secret: data.totp.secret };
    },
    onSuccess: setEnrolment,
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (!enrolment) return;
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolment.factorId, code: code.trim() });
      if (error) throw new Error(/invalid|expired/i.test(error.message) ? t('business.security.wrongCode') : friendlyError(error));
    },
    onSuccess: async () => {
      setEnrolment(null);
      setCode('');
      await reload();
      void queryClient.invalidateQueries({ queryKey: ['mfa-factors'] });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!verified) return;
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: async () => {
      await reload();
      void queryClient.invalidateQueries({ queryKey: ['mfa-factors'] });
    },
  });

  const error = start.error ?? confirm.error ?? remove.error ?? factors.error;

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.security')} subtitle={t('business.security.subtitle')} />
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">{t('business.security.twoStep')}</h2>
          {factors.isLoading ? <Spinner /> : verified ? <Badge color="green">{t('business.security.on')}</Badge> : <Badge color="gray">{t('business.security.off')}</Badge>}
        </div>
        <p className="text-slate-700">{t('business.security.intro')}</p>
        {isPlatformAdmin && !twoStep && (
          <Alert tone="warning">{t('business.security.platformWarn')}</Alert>
        )}

        {!verified && !enrolment && (
          <Button onClick={() => start.mutate()} disabled={start.isPending || factors.isLoading}>
            {start.isPending && <Spinner />} {t('business.security.turnOnButton')}
          </Button>
        )}

        {enrolment && (
          <div className="space-y-3 rounded-xl bg-slate-50 p-4">
            <p className="font-semibold">{t('business.security.step1')}</p>
            <TotpQr uri={enrolment.uri} label={t('business.security.qrAlt')} />
            <p className="text-sm text-slate-600">{t('business.security.samePhone')}</p>
            <a href={enrolment.uri} className={buttonClass('secondary')}>
              {t('business.security.openApp')}
            </a>
            <p className="text-sm text-slate-600">{t('business.security.cantScan')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span dir="ltr" className="select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-base font-semibold tracking-wider ring-1 ring-slate-200">
                {enrolment.secret.match(/.{1,4}/g)?.join(' ') ?? enrolment.secret}
              </span>
              <Button variant="secondary" className="px-3 text-sm" onClick={() => void copyKey()}>
                {keyCopied ? t('common.copied') : t('business.security.copyKey')}
              </Button>
            </div>
            <p className="font-semibold">{t('business.security.step2')}</p>
            <div className="flex flex-wrap gap-2">
              <TextInput
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={t('business.security.codeLabel')}
                dir="ltr"
                className="!w-40 min-h-12 text-center font-mono text-2xl tracking-[0.3em]"
              />
              <Button onClick={() => confirm.mutate()} disabled={confirm.isPending || code.length !== 6}>
                {confirm.isPending && <Spinner />} {t('business.security.turnOn')}
              </Button>
            </div>
          </div>
        )}

        {verified && (
          <>
            <p className="text-sm text-slate-600">{t('business.security.keepSafe')}</p>
            <Button
              variant="danger"
              onClick={() => window.confirm(t('business.security.confirmOff')) && remove.mutate()}
              disabled={remove.isPending || !twoStep}
            >
              {t('business.security.turnOff')}
            </Button>
            {!twoStep && <p className="text-xs text-slate-500">{t('business.security.needCode')}</p>}
          </>
        )}
        {error && <Alert tone="error">{friendlyError(error)}</Alert>}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-lg font-bold">{t('business.security.elsewhere')}</h2>
        <p className="text-slate-700">{t('business.security.elsewhereText')}</p>
        <Button variant="danger" onClick={() => window.confirm(t('business.security.confirmLogoutAll')) && void signOut(true)}>
          {t('business.security.logoutAll')}
        </Button>
      </Card>
    </div>
  );
}
