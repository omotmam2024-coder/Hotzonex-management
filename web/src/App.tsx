import { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { useAuth } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { FullScreenSpinner } from './components/FullScreen';
import { Layout } from './components/Layout';
import { homePathFor, rolesFor } from './lib/nav';
import { page } from './lib/lazyPage';
import { LoginPage } from './features/public/LoginPage';

// Each screen is its own file, loaded when first opened: the app starts with less to download.
const MarkSoldPage = page(() => import('./features/sell/MarkSoldPage'), 'MarkSoldPage');
const CheckVoucherPage = page(() => import('./features/vouchers/CheckVoucherPage'), 'CheckVoucherPage');
const ActiveUsersPage = page(() => import('./features/reports/ActiveUsersPage'), 'ActiveUsersPage');
const DashboardPage = page(() => import('./features/reports/DashboardPage'), 'DashboardPage');
const GenerateVouchersPage = page(() => import('./features/vouchers/GenerateVouchersPage'), 'GenerateVouchersPage');
const PlansPage = page(() => import('./features/plans/PlansPage'), 'PlansPage');
const PortalPage = page(() => import('./features/routers/PortalPage'), 'PortalPage');
const PrintReceiptPage = page(() => import('./features/vouchers/PrintReceiptPage'), 'PrintReceiptPage');
const PrintSetupPage = page(() => import('./features/vouchers/PrintSetupPage'), 'PrintSetupPage');
const PrintSheetPage = page(() => import('./features/vouchers/PrintSheetPage'), 'PrintSheetPage');
const ReportsPage = page(() => import('./features/reports/ReportsPage'), 'ReportsPage');
const ExpensesPage = page(() => import('./features/expenses/ExpensesPage'), 'ExpensesPage');
const RouterFormPage = page(() => import('./features/routers/RouterFormPage'), 'RouterFormPage');
const RoutersPage = page(() => import('./features/routers/RoutersPage'), 'RoutersPage');
const SalesPage = page(() => import('./features/sales/SalesPage'), 'SalesPage');
const SellPage = page(() => import('./features/sell/SellPage'), 'SellPage');
const StaffPage = page(() => import('./features/business/StaffPage'), 'StaffPage');
const BusinessesPage = page(() => import('./features/business/BusinessesPage'), 'BusinessesPage');
const VouchersPage = page(() => import('./features/vouchers/VouchersPage'), 'VouchersPage');
const BuyPage = page(() => import('./features/public/BuyPage'), 'BuyPage');
const PaymentsPage = page(() => import('./features/sales/PaymentsPage'), 'PaymentsPage');
const CashPage = page(() => import('./features/sales/CashPage'), 'CashPage');
const SignupPage = page(() => import('./features/public/SignupPage'), 'SignupPage');
const TermsPage = page(() => import('./features/public/TermsPage'), 'TermsPage');
const NotFoundPage = page(() => import('./features/public/NotFoundPage'), 'NotFoundPage');
const LandingPage = page(() => import('./features/public/LandingPage'), 'LandingPage');
const WelcomePage = page(() => import('./features/business/WelcomePage'), 'WelcomePage');
const BusinessSettingsPage = page(() => import('./features/business/BusinessSettingsPage'), 'BusinessSettingsPage');
const BillingPage = page(() => import('./features/business/BillingPage'), 'BillingPage');
const InvoicePage = page(() => import('./features/business/InvoicePage'), 'InvoicePage');
const SecurityPage = page(() => import('./features/business/SecurityPage'), 'SecurityPage');
const AlertsPage = page(() => import('./features/reports/AlertsPage'), 'AlertsPage');
const ResetPasswordPage = page(() => import('./features/public/ResetPasswordPage'), 'ResetPasswordPage');

function PlatformOnly({ children }: { children: JSX.Element }) {
  const { isPlatformAdmin } = useAuth();
  return isPlatformAdmin ? children : <HomeRedirect />;
}

/** "/": the public landing page for visitors; staff who are logged in go straight to their first page. */
function Home() {
  const { status, profile } = useAuth();
  if (status === 'ready' && profile) return <Navigate to={homePathFor(profile.role)} replace />;
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'mfa') return <Navigate to="/login" replace />;
  // Logged in but the account cannot open (switched off, no profile, error): the app explains why.
  if (status !== 'signed_out') return <Navigate to="/sell" replace />;
  return <LandingPage />;
}

function HomeRedirect() {
  const { profile } = useAuth();
  return <Navigate to={profile ? homePathFor(profile.role) : '/login'} replace />;
}

export function App() {
  const { pathname } = useLocation();
  // Print pages stay light; every other page follows the saved theme.
  useEffect(() => applyTheme(pathname), [pathname]);
  useEffect(() => watchSystemTheme(), []);

  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/" element={<Home />} />
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
            <Route element={<RequireRole roles={rolesFor('/dashboard')} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/sell')} />}>
              <Route path="/sell" element={<SellPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/reports')} />}>
              <Route path="/reports" element={<ReportsPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/expenses')} />}>
              <Route path="/expenses" element={<ExpensesPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/active-users')} />}>
              <Route path="/active-users" element={<ActiveUsersPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/check')} />}>
              <Route path="/check" element={<CheckVoucherPage />} />
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
              <Route path="/billing/invoice/:id" element={<InvoicePage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/security')} />}>
              <Route path="/security" element={<SecurityPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/alerts')} />}>
              <Route path="/alerts" element={<AlertsPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/business')} />}>
              <Route path="/business" element={<BusinessSettingsPage />} />
              <Route path="/welcome" element={<WelcomePage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/staff')} />}>
              <Route path="/staff" element={<StaffPage />} />
            </Route>
            <Route element={<RequireRole roles={rolesFor('/businesses')} />}>
              <Route
                path="/businesses"
                element={
                  <PlatformOnly>
                    <BusinessesPage />
                  </PlatformOnly>
                }
              />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
