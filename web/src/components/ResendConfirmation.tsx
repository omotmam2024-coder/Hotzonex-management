import { useEffect, useState } from 'react';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useT } from '../i18n';
import { Alert } from './ui';

/** "Send the email again" for a new owner whose confirmation email is lost or late. */
export function ResendConfirmation({ email }: { email: string }) {
  const { t } = useT();
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One email a minute: Supabase refuses faster ones anyway.
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function send() {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const { error: e } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}/confirm-email` } });
      if (e) throw e;
      setSent(true);
      setWait(60);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={send}
        disabled={busy || wait > 0}
        className="min-h-12 w-full rounded-xl px-4 font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50 disabled:opacity-50"
      >
        {wait > 0 ? t('public.confirm.resendWait', { n: wait }) : t('public.confirm.resend')}
      </button>
      {sent && <Alert tone="success">{t('public.confirm.resent', { email })}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
