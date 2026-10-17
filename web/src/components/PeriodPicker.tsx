import type { ReactNode } from 'react';
import { jubaToday } from '../lib/format';
import { PERIODS, periodStart, shiftPeriod, type Period } from '../lib/period';
import { TextInput } from './ui';
import { useT } from '../i18n';

const navBtn = 'min-h-11 min-w-11 rounded-xl text-lg font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40';

/** Daily / Weekly / Monthly switch with ‹ date › on one row (no future periods). `children` go at the end of the row. */
export function PeriodPicker({
  period,
  date,
  onPeriod,
  onDate,
  children,
}: {
  period: Period;
  date: string;
  onPeriod: (p: Period) => void;
  onDate: (d: string) => void;
  children?: ReactNode;
}) {
  const { t, dir } = useT();
  const today = jubaToday();
  const atLatest = periodStart(date, period) >= periodStart(today, period);
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl bg-slate-100 p-0.5" role="tablist">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={period === p.key}
            onClick={() => onPeriod(p.key)}
            className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${period === p.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={t('period.previous')} onClick={() => onDate(shiftPeriod(date, period, -1))} className={navBtn}>
          {dir === 'rtl' ? '›' : '‹'}
        </button>
        {period === 'month' ? (
          <TextInput
            aria-label={t('period.month')}
            type="month"
            className="!w-auto text-sm"
            value={date.slice(0, 7)}
            max={today.slice(0, 7)}
            onChange={(e) => e.target.value && onDate(`${e.target.value}-01`)}
          />
        ) : (
          <TextInput aria-label={t('period.day')} type="date" className="!w-auto text-sm" value={date} max={today} onChange={(e) => e.target.value && onDate(e.target.value)} />
        )}
        <button
          type="button"
          aria-label={t('period.next')}
          disabled={atLatest}
          onClick={() => {
            const next = shiftPeriod(date, period, 1);
            onDate(next > today ? today : next);
          }}
          className={navBtn}
        >
          {dir === 'rtl' ? '‹' : '›'}
        </button>
      </div>
      {children}
    </div>
  );
}
