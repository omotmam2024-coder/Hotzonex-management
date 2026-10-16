import { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { FullScreenSpinner } from './components/FullScreen';
import { Layout } from './components/Layout';
import { homePathFor, rolesFor } from './lib/nav';
import { page } from './lib/lazyPage';
import { LoginPage } from './pages/LoginPage';

// Each screen is its own file, loaded when first opened: the app starts with less to download.
const MarkSoldPage = page(() => import('./pages/MarkSoldPage'), 'MarkSoldPage');
const ActiveUsersPage = page(() => import('./pages/ActiveUsersPage'), 'ActiveUsersPage');
const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage');
const GenerateVouchersPage = page(() => import('./pages/GenerateVouchersPage'), 'GenerateVouchersPage');
const PlansPage = page(() => import('./pages/PlansPage'), 'PlansPage');
const PortalPage = page(() => import('./pages/PortalPage'), 'PortalPage');
const PrintReceiptPage = page(() => import('./pages/PrintReceiptPage'), 'PrintReceiptPage');
const PrintSetupPage = page(() => import('./pages/PrintSetupPage'), 'PrintSetupPage');
const PrintSheetPage = page(() => import('./pages/PrintSheetPage'), 'PrintSheetPage');
const ReportsPage = page(() => import('./pages/ReportsPage'), 'ReportsPage');
const RouterFormPage = page(() => import('./pages/RouterFormPage'), 'RouterFormPage');
const RoutersPage = page(() => import('./pages/RoutersPage'), 'RoutersPage');
const SalesPage = page(() => import('./pages/SalesPage'), 'SalesPage');
const SellPage = page(() => import('./pages/SellPage'), 'SellPage');
const StaffPage = page(() => import('./pages/StaffPage'), 'StaffPage');
const BusinessesPage = page(() => import('./pages/BusinessesPage'), 'BusinessesPage');
const VouchersPage = page(() => import('./pages/VouchersPage'), 'VouchersPage');
const BuyPage = page(() => import('./pages/BuyPage'), 'BuyPage');
const PaymentsPage = page(() => import('./pages/PaymentsPage'), 'PaymentsPage');
const CashPage = page(() => import('./pages/CashPage'), 'CashPage');
const SignupPage = page(() => import('./pages/SignupPage'), 'SignupPage');
const TermsPage = page(() => import('./pages/TermsPage'), 'TermsPage');
const BillingPage = page(() => import('./pages/BillingPage'), 'BillingPage');
const SecurityPage = page(() => import('./pages/SecurityPage'), 'SecurityPage');
const AlertsPage = page(() => import('./pages/AlertsPage'), 'AlertsPage');
const ResetPasswordPage = page(() => import('./pages/ResetPasswordPage'), 'ResetPasswordPage');

function PlatformOnly({ children }: { children: JSX.Element }) {
  const { isPlatformAdmin } = useAuth();
  return isPlatformAdmin ? children : <HomeRedirect />;
}

function HomeRedirect() {
  const { profile } = useAuth();
  return <Navigate to={profile ? homePathFor(profile.role) : '/login'} replace />;
}

export function App() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Public: customers buy a card with mobile money (no login). */}
        <Route path="/buy/:slug" element={<BuyPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route element={<RequireAuth />}>
          {/* Print pages render without the app layout so only the paper prints. */}
          <Route element={<RequireRole roles={rolesFor('/vouchers')} />}>
            <Route path="/print/sheet" element={<PrintSheetPage />} />
          </Route>
          <Route path="/print/receipt" element={<PrintReceiptPage />} />
          <Route path="/print/receipt/:voucherId" element={<PrintReceiptPage />} />
          <Route element={<Layout />}>
            <Route index element={<HomeRedirect />} />
            <Route element={<RequireRole roles={rolesFor('/dashboard')} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/sell')} />}>
              <Route path="/sell" element={<SellPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/reports')} />}>
              <Route path="/reports" element={<ReportsPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/active-users')} />}>
              <Route path="/active-users" element={<ActiveUsersPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/sales')} />}>
              <Route path="/sales" element={<SalesPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/vouchers')} />}>
              <Route path="/sales/mark-sold" element={<MarkSoldPage />} />
              <Route path="/vouchers" element={<VouchersPage />} />
              <Route path="/vouchers/generate" element={<GenerateVouchersPage />} />
              <Route path="/vouchers/print" element={<PrintSetupPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/plans')} />}>
              <Route path="/plans" element={<PlansPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/routers')} />}>
              <Route path="/routers" element={<RoutersPage />} />
              <Route path="/routers/new" element={<RouterFormPage />} />
              <Route path="/routers/:id/edit" element={<RouterFormPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/portal')} />}>
              <Route path="/portal" element={<PortalPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/payments')} />}>
              <Route path="/payments" element={<PaymentsPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/cash')} />}>
              <Route path="/cash" element={<CashPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/billing')} />}>
              <Route path="/billing" element={<BillingPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/security')} />}>
              <Route path="/security" element={<SecurityPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/alerts')} />}>
              <Route path="/alerts" element={<AlertsPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/staff')} />}>
              <Route path="/staff" element={<StaffPage />} />
              <Route
                path="/businesses"
                element={
                  <PlatformOnly>
                    <BusinessesPage />
                  </PlatformOnly>
                }
              />
            </Route>
            <Route path="*" element={<HomeRedirect />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
