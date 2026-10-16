import { createClient } from '@supabase/supabase-js';

// Hotzonex Cloud's own Supabase project. The anon key is public by design (every browser gets it;
// the database rules decide what each login may see), so it is built in: the app works even when
// the values pasted into a hosting dashboard are wrong. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// still take over when they are set and valid (another Supabase project).
const DEFAULT_URL = 'https://tyiwnaxdejtsdofgnuow.supabase.co';
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5aXduYXhkZWp0c2RvZmdudW93Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NDYxMjgsImV4cCI6MjEwNzIyMjEyOH0.p4RfV1WgBBY2nJ9p1GT4x0hsgrJvAFjVF1Y1ZhVeP9g';

// Pasting into a dashboard can bring along invisible characters; both values are plain ASCII.
const clean = (v: unknown, allowed: RegExp) => (typeof v === 'string' ? v.replace(allowed, '') : '') || undefined;
const envUrl = clean(import.meta.env.VITE_SUPABASE_URL, /[^A-Za-z0-9:/.\-]/g)?.replace(/\/+$/, '');
const envKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY, /[^A-Za-z0-9._\-]/g);

/** The project ref inside a Supabase anon key, or null when it is not a readable anon key. */
function keyRef(key: string | undefined): string | null {
  try {
    const part = key?.split('.')[1];
    if (!part) return null;
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))) as {
      ref?: unknown;
      role?: unknown;
    };
    return claims.role === 'anon' && typeof claims.ref === 'string' ? claims.ref : null;
  } catch {
    return null;
  }
}

const urlRef = (u: string | undefined) => (u && /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(u) ? u.slice(8).split('.')[0] : null);

// The settings are used only as a matching pair (the key belongs to the URL's project).
const envValid = Boolean(envUrl && envKey && urlRef(envUrl) && keyRef(envKey) === urlRef(envUrl));
const url = envValid ? envUrl : DEFAULT_URL;
const anonKey = envValid ? envKey : DEFAULT_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);
/** The project URL as the client uses it (cleaned). */
export const supabaseUrl = url ?? 'http://localhost:54321';
/** The public (anon) key, for pages that call the server without a login (the Buy page). */
export const supabaseAnonKey = anonKey ?? 'missing-anon-key';

export const supabase = createClient(supabaseUrl, anonKey ?? 'missing-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
