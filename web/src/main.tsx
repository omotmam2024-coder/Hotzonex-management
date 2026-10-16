import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { AuthProvider } from './auth/AuthProvider';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const DAY = 24 * 60 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    // Kept for a day so the saved copy (below) can be shown at once when the app is opened again.
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000, gcTime: DAY },
  },
});

// Small, often-used screens are saved in this browser and shown straight away on the next visit
// while fresh data loads. Long lists (vouchers, sales, reports) always come from the server.
const SAVED = new Set(['dashboard', 'plans', 'routers', 'sites', 'stock', 'staff', 'staff-options', 'businesses', 'batch-options', 'tunnel-server']);

let storage: Storage | undefined;
try {
  storage = window.localStorage;
} catch {
  storage = undefined;
}
const persister = createSyncStoragePersister({ storage, key: 'hzc.cache', throttleTime: 2000 });

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: DAY,
        buster: __APP_VERSION__,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.state.status === 'success' && SAVED.has(String(q.queryKey[0])),
        },
      }}
    >
      <BrowserRouter>
        <ErrorBoundary>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
);

// The app's files are kept by a service worker, so it opens without downloading them again.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Only a speed-up; the app works without it.
    });
  });
}
