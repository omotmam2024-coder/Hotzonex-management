import { translate } from '../i18n/translate';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reloadForUpdate } from '../lib/appUpdate';

interface Props {
  children: ReactNode;
  /** The error clears when this changes (e.g. the page address), so the menu still works. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/** After a new version is published, an open app may ask for page files that no longer exist. */
function isOldVersion(error: Error): boolean {
  return /dynamically imported module|importing a module script failed|loading chunk|failed to fetch/i.test(error.message);
}

/**
 * Shows a short message with a Reload button instead of a blank screen when a page fails to draw.
 * Files missing after an update reload the app once by themselves.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    // Otherwise the Reload button below still works.
    if (isOldVersion(error)) reloadForUpdate();
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const update = isOldVersion(this.state.error);
    return (
      <div role="alert" className="mx-auto my-10 max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">{translate(update ? 'error.updateTitle' : 'error.title')}</h2>
        <p className="mt-2 text-slate-600">
          {translate(update ? 'error.updateText' : 'error.text')}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700"
        >
          {translate('common.reload')}
        </button>
      </div>
    );
  }
}
