// A plan's data limit: saved in MB (as the router counts it, 1 MB = 1024 × 1024 bytes), typed and
// shown in MB or GB.

/** A plan's data limit: 500 → "500 MB", 1024 → "1 GB", 1536 → "1.5 GB". */
export function formatDataLimit(mb: number): string {
  return mb >= 1024 ? `${Math.round((mb / 1024) * 100) / 100} GB` : `${mb} MB`;
}

export type DataUnit = 'MB' | 'GB';
/** 1 GB = 1024 MB (as on the router). GB may have decimals: 1.5 GB = 1536 MB. */
export const toMegabytes = (v: string, unit: DataUnit) =>
  unit === 'MB' ? (/^\d+$/.test(v) ? Number(v) : NaN) : /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 1024) : NaN;
/** A saved limit shown in GB when it is a whole number or a clean decimal of GB, else in MB. */
export function splitDataLimit(mb: number | null): { dataLimitAmount: string; dataUnit: DataUnit } {
  if (!mb) return { dataLimitAmount: '', dataUnit: 'GB' };
  const gb = Math.round((mb / 1024) * 100) / 100;
  return mb >= 1024 && Math.round(gb * 1024) === mb ? { dataLimitAmount: String(gb), dataUnit: 'GB' } : { dataLimitAmount: String(mb), dataUnit: 'MB' };
}
/** Digits, and in GB one decimal point with up to 2 decimals. */
export const cleanDataAmount = (v: string, unit: DataUnit) =>
  unit === 'MB' ? v.replace(/\D/g, '') : v.replace(',', '.').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{2}).+/, '$1');
