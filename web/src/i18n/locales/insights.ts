// Texts of the Insights page. Every English key must also have Arabic and Kiswahili.

const en = {
  'nav.insights': 'Insights',
  'insights.title': 'Insights',
  'insights.subtitle': 'When and what sells, what to expect next week, and anything unusual',
  'insights.period': 'Period',
  'insights.lastDays': 'Last {n} days',
  'insights.noSales': 'No sales in this period yet. Insights appear after the first sales.',
  'insights.flags': 'Worth a look',
  'insights.flagsNote': 'These are signals, not proof: check the Sales page before drawing conclusions.',
  'insights.flag.drop': 'Revenue fell {pct}% in the last 7 days ({last}) compared with the 7 days before ({prev}).',
  'insights.flag.voids': '{name} voided {voids} of {total} sales.',
  'insights.flag.discounts': '{name} gave a promo discount on {n} of {total} sales.',
  'insights.revenue': 'Revenue',
  'insights.sold': 'Cards sold',
  'insights.bestHour': 'Best hour',
  'insights.bestDay': 'Best day',
  'insights.byHour': 'Revenue by hour of the day',
  'insights.barsNote': 'Bar = revenue; the small number on the right = cards sold.',
  'insights.byWeekday': 'Revenue by day of the week',
  'insights.byPlan': 'Revenue by plan',
  'insights.forecast': 'Next 7 days',
  'insights.forecastText': 'Expected revenue: about {total}.',
  'insights.forecastNote': 'A guide only: the average of the same weekday over the period. Holidays, outages and promotions are not counted.',
  'insights.forecastNeeds': 'Choose 14 days or more to see a forecast.',
  'reports.alerts.cbDaily': 'Send me a daily report',
  'reports.alerts.dailyHint': 'Every evening at 18:00: revenue, cards sold, the best plan, voids and offline routers. Sent to Telegram and WhatsApp in the language chosen below.',
  'reports.alerts.dailyNeedsChannel': 'Connect Telegram or add a WhatsApp number first: the report is sent there.',
  'reports.alerts.kind.report': 'Report',
}

export type Keys = Record<keyof typeof en, string>;

export const insights = { en };
