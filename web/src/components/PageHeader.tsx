import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 lg:mb-7">
      <div className="min-w-0">
        <h1 className="text-[28px] font-extrabold leading-none text-slate-900 sm:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] text-slate-600">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
