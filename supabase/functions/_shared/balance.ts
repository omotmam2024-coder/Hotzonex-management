// What a customer may learn about their own WiFi card on the public Buy page.
//
// A card that was never logged in with is NEVER described (not even "this card exists"): otherwise the
// page would let anyone guess codes to find working cards. Only a card already in use shows its balance.

/** The code as typed: spaces removed; letters and digits only, 4 to 20 characters. */
export function cleanCardCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, '');
  return /^[0-9A-Za-z]{4,20}$/.test(t) ? t : null;
}

export interface CardRow {
  code: string;
  status: string;
  first_used_at: string | null;
  expires_at: string | null;
  uptime_used_seconds: number | null;
  bytes_used: number | null;
  plans: { name: string; uptime_seconds: number | null; data_limit_mb: number | null } | null;
}

export interface CardBalance {
  plan: string;
  /** "active": can still be used; "finished": time, data or the use-within period ran out. */
  state: 'active' | 'finished';
  /** Time left in seconds; null when the plan has no time limit. */
  seconds_left: number | null;
  /** Data left in MB (rounded down); null when the plan has no data limit. */
  mb_left: number | null;
  /** The card stops working at this moment (use-within period); null when none. */
  expires_at: string | null;
}

/** True only for a card that has already been used (or is running or finished). */
export function isStarted(r: CardRow): boolean {
  if (r.status === 'disabled') return false;
  return r.first_used_at !== null || r.status === 'active' || r.status === 'expired';
}

export function balanceOf(r: CardRow, now: number): CardBalance {
  const timeLimit = r.plans?.uptime_seconds && r.plans.uptime_seconds > 0 ? r.plans.uptime_seconds : null;
  const dataLimit = r.plans?.data_limit_mb && r.plans.data_limit_mb > 0 ? r.plans.data_limit_mb : null;
  const secondsLeft = timeLimit === null ? null : Math.max(0, timeLimit - (r.uptime_used_seconds ?? 0));
  const mbLeft = dataLimit === null ? null : Math.max(0, Math.floor(dataLimit - (r.bytes_used ?? 0) / 1_048_576));
  const expired = r.expires_at !== null && new Date(r.expires_at).getTime() <= now;
  const finished = r.status === 'expired' || expired || secondsLeft === 0 || mbLeft === 0;
  return { plan: r.plans?.name ?? '', state: finished ? 'finished' : 'active', seconds_left: secondsLeft, mb_left: mbLeft, expires_at: r.expires_at };
}
