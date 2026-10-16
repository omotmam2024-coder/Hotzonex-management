import type { ReactNode } from "react";
import { PERIODS, shiftPeriod, type Period } from "../lib/period";
import { TextInput } from "./ui";

const navBtn =
  "min-h-11 min-w-11 rounded-xl text-lg font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50";

/** Daily / Weekly / Monthly switch with ‹ date › on one row. `children` go at the end of the row. */
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
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl bg-slate-100 p-0.5" role="tablist">
        {PERIODS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={period === t.key}
            onClick={() => onPeriod(t.key)}
            className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${period === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous period"
          onClick={() => onDate(shiftPeriod(date, period, -1))}
          className={navBtn}
        >
          ‹
        </button>
        {period === "month" ? (
          <TextInput
            aria-label="Month"
            type="month"
            className="!w-auto text-sm"
            value={date.slice(0, 7)}
            onChange={(e) => e.target.value && onDate(`${e.target.value}-01`)}
          />
        ) : (
          <TextInput
            aria-label="Day"
            type="date"
            className="!w-auto text-sm"
            value={date}
            onChange={(e) => e.target.value && onDate(e.target.value)}
          />
        )}
        <button
          type="button"
          aria-label="Next period"
          onClick={() => onDate(shiftPeriod(date, period, 1))}
          className={navBtn}
        >
          ›
        </button>
      </div>
      {children}
    </div>
  );
}
