import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { formatJubaTime } from '../lib/format';
import { supabase } from '../lib/supabase';

/** Shown on every page while a platform admin manages a customer's business. */
export function SupportBar() {
  const { support, reload } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!support) return null;
  async function exit() {
    setBusy(true);
    await supabase.rpc('platform_support_stop');
    await reload();
    setBusy(false);
    navigate('/businesses');
  }
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-600 p-3 text-sm font-semibold text-white print:hidden">
      <span>
        Support mode: you are managing <b>{support.name}</b> until {formatJubaTime(support.until)}. Everything you do is recorded in their account.
      </span>
      <button type="button" onClick={() => void exit()} disabled={busy} className="rounded-lg bg-white px-3 py-1.5 text-red-700 disabled:opacity-60">
        {busy ? 'Leaving…' : 'Exit support mode'}
      </button>
    </div>
  );
}
