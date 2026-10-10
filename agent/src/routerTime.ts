/**
 * Seconds → RouterOS time string, e.g. 9000 → "2h30m", 93784 → "1d2h3m4s", 604800 → "1w".
 * Used only at the router boundary; the database always stores seconds.
 */
export function toRouterOsTime(totalSeconds: number): string {
  if (!Number.isInteger(totalSeconds) || totalSeconds <= 0) throw new Error(`Invalid duration: ${totalSeconds}`);
  const units: [string, number][] = [
    ['w', 604800],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  let rest = totalSeconds;
  let out = '';
  for (const [suffix, size] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      out += `${n}${suffix}`;
      rest -= n * size;
    }
  }
  return out;
}

/**
 * RouterOS time string → seconds. Accepts "1w2d3h4m5s" and "hh:mm:ss" forms, e.g. "2h30m" → 9000.
 */
export function fromRouterOsTime(value: string | undefined | null): number {
  if (!value) return 0;
  const clock = /^(?:(\d+)d)?\s*(\d{1,2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (clock) return Number(clock[1] ?? 0) * 86400 + Number(clock[2]) * 3600 + Number(clock[3]) * 60 + Number(clock[4]);
  const sizes: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0;
  for (const match of value.matchAll(/(\d+)(ms|[wdhms])/g)) {
    if (match[2] === 'ms') continue;
    total += Number(match[1]) * (sizes[match[2] ?? 's'] ?? 0);
  }
  return total;
}
