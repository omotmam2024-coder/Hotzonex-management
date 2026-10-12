import { createClient } from '@supabase/supabase-js';

// Pasting these into a hosting dashboard can bring along invisible characters (spaces, line breaks,
// "smart" punctuation); a header with such a character makes every request fail. Both values are
// plain ASCII by nature, so anything else is dropped.
const clean = (v: unknown, allowed: RegExp) => (typeof v === 'string' ? v.replace(allowed, '') : '') || undefined;
const url = clean(import.meta.env.VITE_SUPABASE_URL, /[^A-Za-z0-9:/.\-]/g)?.replace(/\/+$/, '');
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY, /[^A-Za-z0-9._\-]/g);

export const supabaseConfigured = Boolean(url && anonKey);
/** The project URL as the client uses it (cleaned). */
export const supabaseUrl = url ?? 'http://localhost:54321';

export const supabase = createClient(supabaseUrl, anonKey ?? 'missing-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
