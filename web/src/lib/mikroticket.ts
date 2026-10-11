// Reads the plan details MikroTicket stores in its hotspot user profile names, e.g.
// "profile_1Hr-se:-co:1000-pr:-lu:7-lp:7-ut:0d 01:00:00-bt:-kt:true-nu:true-np:true-tp:2-vl:1d 12:00:00"
//   label 1Hr, co = price, ut = time allowed, vl = validity after first login (optional).

export interface MikroticketProfile {
  label: string;
  price: number;
  uptimeSeconds: number;
  validitySeconds: number | null;
}

/** "0d 01:00:00" / "7d 00:00:00" → seconds; null when absent or zero. */
function duration(value: string | undefined): number | null {
  const m = value ? /^(\d+)d (\d{1,2}):(\d{2}):(\d{2})$/.exec(value.trim()) : null;
  if (!m) return null;
  const s = Number(m[1]) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  return s > 0 ? s : null;
}

export function parseMikroticketProfile(name: string): MikroticketProfile | null {
  const m = /^profile_(.+?)-se:/.exec(name);
  if (!m?.[1]) return null;
  const field = (key: string) => new RegExp(`-${key}:([^-]*)`).exec(name)?.[1];
  const price = Number(field('co'));
  const uptime = duration(field('ut'));
  if (!uptime || !Number.isFinite(price)) return null;
  return { label: m[1], price: Math.round(price), uptimeSeconds: uptime, validitySeconds: duration(field('vl')) };
}

/** Short name to show for a router profile: MikroTicket's label, or the name itself. */
export function profileLabel(name: string): string {
  const p = parseMikroticketProfile(name);
  return p ? `${p.label} (MikroTicket)` : name;
}
