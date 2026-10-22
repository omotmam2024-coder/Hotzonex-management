import type { ReactNode } from 'react';

/** One numbered step of a short how-to: a big number, a plain title, then what to do. */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{n}</span>
      <div className="min-w-0 flex-1 space-y-2 pt-1">
        <p className="font-semibold text-slate-900">{title}</p>
        {children}
      </div>
    </div>
  );
}
