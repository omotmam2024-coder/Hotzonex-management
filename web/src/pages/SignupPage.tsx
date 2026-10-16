import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { friendlyError } from '../lib/errors';
import { invokeFunction } from '../lib/functions';

const input =
  'min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

/** Public: a new WiFi business starts its free trial and is logged in straight away. */
export function SignupPage() {
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ business_name: '', site_name: '', full_name: '', phone: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'ready') return <Navigate to="/" replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await invokeFunction('signup', { ...form, email: form.email.trim(), timezone: 'Africa/Juba' });
      await signIn(form.email.trim(), form.password);
      navigate('/routers/new', { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input value={form[k]} onChange={set(k)} className={input} {...props} />
    </label>
  );

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-white/10 sm:p-8">
        <div className="mb-5 text-center">
          <img src="/logo.png" alt="Hotzonex WiFi" className="mx-auto h-20 w-auto" />
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Start your free trial</h1>
          <p className="text-slate-600">Run your MikroTik hotspot business from your phone: cards, sales, agents, mobile money.</p>
        </div>
        <form onSubmit={submit} className="space-y-3" noValidate>
          {field('business_name', 'Business name', { autoComplete: 'organization', required: true })}
          {field('site_name', 'First site (optional)', { placeholder: 'e.g. Main office' })}
          {field('full_name', 'Your name', { autoComplete: 'name', required: true })}
          {field('phone', 'Phone number', { type: 'tel', inputMode: 'tel', autoComplete: 'tel', required: true })}
          {field('email', 'Email (your login)', { type: 'email', inputMode: 'email', autoComplete: 'username', required: true })}
          {field('password', 'Password (at least 8 characters)', { type: 'password', autoComplete: 'new-password', required: true })}
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !form.business_name || !form.full_name || !form.phone || !form.email || form.password.length < 8}
            className="min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Creating your account…' : 'Start free trial'}
          </button>
          <p className="text-center text-xs text-slate-500">
            By starting the free trial you agree to the{' '}
            <Link to="/terms" className="font-semibold text-brand-700 underline">
              terms of service and privacy
            </Link>
            .
          </p>
          <p className="text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
