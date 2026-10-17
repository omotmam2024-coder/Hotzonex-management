import { translateMessage } from '../i18n/translate';

const NETWORK_RE =
  /failed to fetch|networkerror|load failed|network request failed|timeout|aborted|failed to send a request to the edge function|relay error/i;

/** True when the message means the server could not be reached (no internet, weak signal). */
export function isNetworkError(message: string): boolean {
  return NETWORK_RE.test(message);
}

/** Turn any thrown value into a short, plain message suitable for staff, in the chosen language. */
export function friendlyError(err: unknown): string {
  return translateMessage(englishError(err));
}

function englishError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err);

  const msg = raw.toLowerCase();
  if (msg.includes('invalid login credentials')) return 'Wrong email or password.';
  if (msg.includes('email not confirmed')) return 'This account has not been confirmed yet. Ask an admin.';
  if (isNetworkError(msg) && !msg.includes('timeout') && !msg.includes('aborted'))
    return 'No internet connection to the server. Check the network and try again.';
  if (msg.includes('jwt expired')) return 'Your login has expired. Please log in again.';
  if (raw.length > 0 && raw.length < 160 && !raw.includes('\n')) return raw;
  return 'Something went wrong. Please try again.';
}
