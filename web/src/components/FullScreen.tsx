import { translate } from '../i18n';
import { Button } from './ui';
export function FullScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label={translate('common.loading')}>
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
    </div>
  );
}

interface FullScreenMessageProps {
  title: string;
  message: string;
  onSignOut?: () => void;
}

export function FullScreenMessage({ title, message, onSignOut }: FullScreenMessageProps) {
  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="mt-3 text-slate-600">{message}</p>
        {onSignOut && (
          <Button size="lg" block onClick={onSignOut} className="mt-6">
            {translate('common.logout')}
          </Button>
        )}
      </div>
    </div>
  );
}
