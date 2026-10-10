const TZ = 'Africa/Juba';

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "14:20" if the moment is today in Juba, otherwise "9 Oct, 14:20". */
export function formatJubaTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return dayFmt.format(d) === dayFmt.format(new Date()) ? timeFmt.format(d) : dateTimeFmt.format(d);
}

/** "just now", "5 min ago", "3 h ago", or a date. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return formatJubaTime(iso);
}

/** Strips a "/32" suffix Postgres may add to inet values. */
export function bareIp(ip: string): string {
  return ip.split('/')[0] ?? ip;
}

const numberFmt = new Intl.NumberFormat('en-US');

/** 1000 → "1,000 SSP" */
export function formatSSP(amount: number): string {
  return `${numberFmt.format(amount)} SSP`;
}

export function formatNumber(n: number): string {
  return numberFmt.format(n);
}

/** Seconds → short, number-first text for staff and cards: "30 min", "2 hrs", "1 hr 30 min", "1 day", "7 days". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0 min';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`);
  if (minutes && !days) parts.push(`${minutes} min`);
  if (parts.length === 0) return `${totalSeconds} sec`;
  return parts.join(' ');
}

/** Today's date in Juba as YYYY-MM-DD (for date inputs and report periods). */
export function jubaToday(): string {
  return dayFmt.format(new Date());
}

/** "48213570" → ["4821", "3570"]: groups of 4 for reading a code aloud. */
export function codeGroups(code: string): string[] {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += 4) groups.push(code.slice(i, i + 4));
  return groups;
}

/** 1536000 → "1.5 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
