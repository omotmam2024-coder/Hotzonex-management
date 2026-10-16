/** Turn any thrown value into a short, plain message suitable for staff. */
export function friendlyError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err);

  const msg = raw.toLowerCase();
  if (msg.includes('invalid login credentials')) return 'Wrong email or password.';
  if (msg.includes('email not confirmed')) return 'This account has not been confirmed yet. Ask an admin.';
  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    // supabase-js when an Edge Function cannot be reached (no internet, weak signal).
    msg.includes('failed to send a request to the edge function') ||
    msg.includes('relay error')
  )
    return 'No internet connection to the server. Check the network and try again.';
  if (msg.includes('jwt expired')) return 'Your login has expired. Please log in again.';
  if (raw.length > 0 && raw.length < 160 && !raw.includes('\n')) return raw;
  return 'Something went wrong. Please try again.';
}
