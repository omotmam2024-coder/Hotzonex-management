import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
  secondary: 'bg-white text-slate-800 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
  danger: 'bg-white text-red-700 shadow-sm ring-1 ring-inset ring-red-200 hover:bg-red-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
};

/** The button look, for links that act as buttons: `<Link className={buttonClass('secondary')}>`. */
export function buttonClass(variant: Variant = 'primary', className = ''): string {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${VARIANTS[variant]} ${className}`;
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...props} className={buttonClass(variant, className)} />;
}

/** A small text button inside tables and lists ("Edit", "Receipt", "Void"), still 44 px tall to tap. */
export const textButtonClass = 'inline-flex min-h-11 items-center px-2 text-sm font-semibold hover:underline disabled:opacity-50';

const inputClass =
  'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} py-2.5 ${props.className ?? ''}`} />;
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="text-slate-800">{label}</span>
    </label>
  );
}

type Tone = 'error' | 'warning' | 'success' | 'info';
const TONES: Record<Tone, string> = {
  error: 'bg-red-50 text-red-800 ring-red-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  success: 'bg-green-50 text-green-800 ring-green-200',
  info: 'bg-brand-50 text-brand-900 ring-brand-100',
};

export function Alert({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ring-1 ${TONES[tone]}`}>
      {children}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 sm:p-5 ${className}`}>{children}</div>;
}

/** A titled table card on report pages (Reports, Expenses & profit). Prints without its shadow. */
export function ReportSection({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`report-section rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {aside && <span className="text-xs text-slate-500">{aside}</span>}
      </div>
      <div className="overflow-x-auto px-4 pb-2">{children}</div>
    </section>
  );
}

/** Table cells on report pages. */
export const reportTh = 'py-2 pr-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 last:pr-0';
export const reportTd = 'py-1.5 pr-3 last:pr-0';

/** A4 print rules for report pages. */
export function ReportPrintStyle() {
  return <style>{`@page { size: A4 portrait; margin: 12mm; } @media print { .report-section { break-inside: avoid; box-shadow: none; border: 1px solid #e2e8f0; } }`}</style>;
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden="true" />;
}

const BADGES = {
  green: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-slate-200 text-slate-700',
  blue: 'bg-brand-100 text-brand-900',
} as const;

export function Badge({ color, children }: { color: keyof typeof BADGES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGES[color]}`}>{children}</span>;
}
