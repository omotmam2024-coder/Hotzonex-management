import { PageHeader } from '../components/PageHeader';

interface PlannedPageProps {
  title: string;
  phase: number;
  features: string[];
}

/** Shown for sections whose screens are delivered in a later build phase. */
export function PlannedPage({ title, phase, features }: PlannedPageProps) {
  return (
    <div>
      <PageHeader title={title} />
      <div className="max-w-2xl rounded-2xl bg-white p-6 shadow-sm">
        <p className="font-semibold text-slate-900">This screen arrives in Phase {phase}.</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-600">
          {features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
