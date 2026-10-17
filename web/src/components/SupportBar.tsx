import { translate } from '../i18n/translate';
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
        {translate('support.managing', { name: support.name, until: formatJubaTime(support.until) })}
      </span>
      <button type="button" onClick={() => void exit()} disabled={busy} className="min-h-11 rounded-lg bg-white px-3 py-1.5 text-red-700 disabled:opacity-60">
        {translate(busy ? 'support.leaving' : 'support.exit')}
      </button>
    </div>
  );
}
