import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type Variant = 'primary' | 'accent' | 'secondary' | 'outline' | 'success' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800',
  // The orange of the Hotzonex logo: for the one call to action that should stand out (darker shades keep white text readable).
  accent: 'bg-accent-700 text-white shadow-sm hover:bg-accent-800 active:bg-accent-900',
  secondary: 'bg-white text-slate-800 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 active:bg-slate-100',
  outline: 'text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50 active:bg-brand-100',
  success: 'bg-green-700 text-white shadow-sm hover:bg-green-800 active:bg-green-900',
  danger: 'bg-white text-red-700 shadow-sm ring-1 ring-inset ring-red-200 hover:bg-red-50 active:bg-red-100',
  ghost: 'text-slate-700 hover:bg-slate-100 active:bg-slate-200',
};

/** Every size is at least 44 px tall, so a thumb can always hit it. `lg` is for the main button of a form or page. */
const SIZES: Record<Size, string> = {
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-11 px-4',
  lg: 'min-h-12 px-5 text-lg',
};

/** The button look, for links that act as buttons: `<Link className={buttonClass('secondary')}>`. */
export function buttonClass(variant: Variant = 'primary', className = '', size: Size = 'md', block = false): string {
  return `inline-flex select-none items-center justify-center gap-2 rounded-lg font-bold transition duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${SIZES[size]} ${block ? 'w-full' : ''} ${VARIANTS[variant]} ${className}`;
}

/**
 * The standard button. `loading` shows a spinner, disables the button (a second tap cannot send twice) and tells
 * screen readers it is busy; `block` makes it full width; `size="lg"` is the big main button of a form.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  className = '',
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; block?: boolean; loading?: boolean }) {
  return (
    <button type="button" {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, className, size, block)}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/**
 * A choosable option that looks like a button (tabs, plan or router pickers, sizes). Use with `aria-pressed={selected}`:
 * `<button type="button" aria-pressed={on} className={chipClass(on)}>`.
 */
export function chipClass(selected: boolean, className = ''): string {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 font-bold ring-1 ring-inset transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
    selected ? 'bg-brand-600 text-white shadow-sm ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
  } ${className}`;
}

/** A small text button inside tables and lists ("Edit", "Receipt", "Void"), still 44 px tall to tap. */
export const textButtonClass = 'inline-flex min-h-11 items-center px-2 text-sm font-semibold hover:underline disabled:opacity-50';

const inputClass =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-slate-700">{label}</span>
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
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ring-1 ${TONES[tone]}`}>
      {children}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl bg-white p-4 shadow-card ring-1 ring-slate-200 sm:p-5 ${className}`}>{children}</div>;
}

/** A titled table card on report pages (Reports, Expenses & profit). Prints without its shadow. */
export function ReportSection({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`report-section rounded-xl bg-white shadow-card ring-1 ring-slate-200 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {aside && <span className="text-xs text-slate-500">{aside}</span>}
      </div>
      <div className="overflow-x-auto px-4 pb-2">{children}</div>
    </section>
  );
}

/** Table cells on report pages. */
export const reportTh = 'py-2 pe-3 text-xs font-bold text-slate-500 last:pe-0';
export const reportTd = 'py-1.5 pe-3 last:pe-0';

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
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${BADGES[color]}`}>{children}</span>;
}
