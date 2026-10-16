import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Spinner } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';

interface Enrolment {
  factorId: string;
  qr: string;
  secret: string;
}

/** Each person's own login security: the 2-step login (authenticator app) and logging out everywhere. */
export function SecurityPage() {
  const { isPlatformAdmin, twoStep, reload, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');

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
      return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
    },
    onSuccess: setEnrolment,
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (!enrolment) return;
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolment.factorId, code: code.trim() });
      if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'Wrong or expired code. Type the newest code from your app.' : friendlyError(error));
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
      <PageHeader title="Security" subtitle="Protect your login" />
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">2-step login</h2>
          {factors.isLoading ? <Spinner /> : verified ? <Badge color="green">On</Badge> : <Badge color="gray">Off</Badge>}
        </div>
        <p className="text-slate-700">
          After your password, Hotzonex asks for a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft
          Authenticator or similar). Someone who learns your password still cannot get in.
        </p>
        {isPlatformAdmin && !twoStep && (
          <Alert tone="warning">
            You run Hotzonex Cloud: support mode, billing and all businesses only open after logging in with your 2-step code.
          </Alert>
        )}

        {!verified && !enrolment && (
          <Button onClick={() => start.mutate()} disabled={start.isPending || factors.isLoading}>
            {start.isPending && <Spinner />} Turn on 2-step login
          </Button>
        )}

        {enrolment && (
          <div className="space-y-3 rounded-xl bg-slate-50 p-4">
            <p className="font-semibold">1. In your authenticator app, add an account and scan this code:</p>
            <img src={enrolment.qr} alt="QR code for your authenticator app" className="h-44 w-44 rounded-lg bg-white p-2" />
            <p className="text-sm text-slate-600">
              Can't scan? Type this key instead: <span className="select-all break-all font-mono font-semibold">{enrolment.secret}</span>
            </p>
            <p className="font-semibold">2. Type the 6-digit code the app shows:</p>
            <div className="flex flex-wrap gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="min-h-12 w-40 rounded-xl border border-slate-300 text-center font-mono text-2xl tracking-[0.3em]"
              />
              <Button onClick={() => confirm.mutate()} disabled={confirm.isPending || code.length !== 6}>
                {confirm.isPending && <Spinner />} Turn on
              </Button>
            </div>
          </div>
        )}

        {verified && (
          <>
            <p className="text-sm text-slate-600">Keep your phone safe. If you lose it, ask Hotzonex Cloud to remove the 2-step login from your account, then set it up again.</p>
            <Button
              variant="danger"
              onClick={() => window.confirm('Turn off the 2-step login? Your password alone will open your account again.') && remove.mutate()}
              disabled={remove.isPending || !twoStep}
            >
              Turn off 2-step login
            </Button>
            {!twoStep && <p className="text-xs text-slate-500">Log in with your code to change this.</p>}
          </>
        )}
        {error && <Alert tone="error">{friendlyError(error)}</Alert>}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-lg font-bold">Logged in elsewhere?</h2>
        <p className="text-slate-700">End your login on every phone and computer at once. Change your password too if you think someone knows it.</p>
        <Button variant="danger" onClick={() => window.confirm('Log out on all devices?') && void signOut(true)}>
          Log out on all devices
        </Button>
      </Card>
    </div>
  );
}
