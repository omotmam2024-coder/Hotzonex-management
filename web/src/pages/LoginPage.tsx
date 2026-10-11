import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabaseConfigured } from '../lib/supabase';
import { homePathFor } from '../lib/nav';
import { FullScreenSpinner } from '../components/FullScreen';

export function LoginPage() {
  const { status, profile, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'loading') return <FullScreenSpinner />;
  if (status !== 'signed_out') {
    const from = (location.state as { from?: string } | null)?.from;
    const target = from && from !== '/login' ? from : profile ? homePathFor(profile.role) : '/';
    return <Navigate to={target} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-brand-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Hotzonex WiFi" className="h-28 w-auto" />
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Hotzonex Cloud</h1>
          <p className="text-slate-600">Staff login</p>
        </div>

        {!supabaseConfigured && (
          <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            The app is not connected to Supabase. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in web/.env.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
}
