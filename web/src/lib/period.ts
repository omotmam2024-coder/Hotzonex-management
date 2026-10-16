/** Day / week (Monday–Sunday) / calendar-month periods, as the report functions in the database use them. */
export type Period = "day" | "week" | "month";

export const PERIODS: { key: Period; label: string; noun: string }[] = [
  { key: "day", label: "Daily", noun: "Daily" },
  { key: "week", label: "Weekly", noun: "Weekly" },
  { key: "month", label: "Monthly", noun: "Monthly" },
];

export const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" });
const longDay = fmt({
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
export const shortDay = fmt({
  weekday: "short",
  day: "numeric",
  month: "short",
});
const monthYear = fmt({ month: "long", year: "numeric" });

export function parsePeriod(value: string | null): Period {
  return value === "week" || value === "month" ? value : "day";
}

/** Moves a date by whole periods (days, weeks or calendar months). */
export function shiftPeriod(
  date: string,
  period: Period,
  steps: number,
): string {
  const d = utc(date);
  if (period === "day") d.setUTCDate(d.getUTCDate() + steps);
  else if (period === "week") d.setUTCDate(d.getUTCDate() + 7 * steps);
  else {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + steps);
  }
  return iso(d);
}

export function periodLabel(
  period: Period,
  start: string,
  end: string,
): string {
  if (period === "day") return longDay.format(utc(start));
  if (period === "week")
    return `${shortDay.format(utc(start))} – ${shortDay.format(utc(end))} ${utc(end).getUTCFullYear()}`;
  return monthYear.format(utc(start));
}

/** "Today" / "This week" / "This month". */
export function currentPeriodName(period: Period): string {
  return period === "day"
    ? "Today"
    : period === "week"
      ? "This week"
      : "This month";
}
