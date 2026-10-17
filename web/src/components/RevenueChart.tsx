import { useState } from 'react';
import { formatNumber, formatSSP } from '../lib/format';
import { textButtonClass } from './ui';

export interface DayRevenue {
  day: string; // YYYY-MM-DD (Juba)
  revenue: number;
  sold: number;
}

const dayLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
const fullLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const parseDay = (d: string) => new Date(`${d}T00:00:00Z`);

/** Rounds the axis maximum up to a friendly number (1, 2, 2.5, 5 × 10^n). */
function niceMax(value: number): number {
  if (value <= 0) return 1000;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

/** Single-series bar chart of daily revenue: one hue, recessive grid, hover/tap tooltip, table view. */
export function RevenueChart({ days }: { days: DayRevenue[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = niceMax(Math.max(0, ...days.map((d) => d.revenue)));
  const peak = days.reduce((best, d, i) => (d.revenue > (days[best]?.revenue ?? -1) ? i : best), 0);
  const ticks = [max, max / 2, 0];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Revenue, last 14 days</h2>
        <button type="button" onClick={() => setAsTable((v) => !v)} className={`${textButtonClass} -mr-2 text-brand-700`}>
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>

      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1">Day</th>
                <th className="py-1 text-right">Vouchers</th>
                <th className="py-1 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className="border-t border-slate-100">
                  <td className="py-1.5">{fullLabel.format(parseDay(d.day))}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatNumber(d.sold)}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{formatSSP(d.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2">
          {/* y-axis labels */}
          <div className="relative h-48 w-10 shrink-0 text-right text-xs text-slate-500">
            {ticks.map((t, i) => (
              <span key={t} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}>
                {compact(t)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-48" onMouseLeave={() => setActive(null)}>
              {/* recessive grid */}
              {ticks.map((t, i) => (
                <div key={t} className="absolute inset-x-0 border-t border-slate-200" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} />
              ))}
              <div className="absolute inset-0 flex items-end gap-[2px]">
                {days.map((d, i) => {
                  const h = (d.revenue / max) * 100;
                  return (
                    <button
                      key={d.day}
                      type="button"
                      className="relative flex h-full flex-1 items-end justify-center focus:outline-none"
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onClick={() => setActive(active === i ? null : i)}
                      aria-label={`${fullLabel.format(parseDay(d.day))}: ${formatSSP(d.revenue)}, ${d.sold} vouchers`}
                    >
                      {i === peak && d.revenue > 0 && active === null && (
                        <span className="absolute z-10 whitespace-nowrap text-[11px] font-semibold text-slate-700" style={{ bottom: `calc(${h}% + 4px)` }}>
                          {compact(d.revenue)}
                        </span>
                      )}
                      <span
                        className={`block w-full max-w-[28px] rounded-t-[4px] transition-colors ${active === i ? 'bg-brand-700' : 'bg-brand-500'}`}
                        style={{ height: d.revenue > 0 ? `max(${h}%, 2px)` : '0' }}
                      />
                    </button>
                  );
                })}
              </div>
              {active !== null && days[active] && (
                <div
                  className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
                  style={{ left: `${Math.min(Math.max(((active + 0.5) / days.length) * 100, 18), 82)}%` }}
                >
                  <div className="font-semibold">{fullLabel.format(parseDay(days[active].day))}</div>
                  <div className="tabular-nums">{formatSSP(days[active].revenue)}</div>
                  <div className="tabular-nums text-slate-300">{formatNumber(days[active].sold)} vouchers</div>
                </div>
              )}
            </div>
            <div className="mt-1 flex gap-[2px] text-[11px] text-slate-500">
              {days.map((d, i) => (
                <span key={d.day} className="flex-1 text-center tabular-nums">
                  {i % 2 === (days.length - 1) % 2 ? dayLabel.format(parseDay(d.day)) : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
