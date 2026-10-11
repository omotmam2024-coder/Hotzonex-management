import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { Layout } from './components/Layout';
import { homePathFor, rolesFor } from './lib/nav';
import { LoginPage } from './pages/LoginPage';
import { MarkSoldPage } from './pages/MarkSoldPage';
import { ActiveUsersPage } from './pages/ActiveUsersPage';
import { DashboardPage } from './pages/DashboardPage';
import { GenerateVouchersPage } from './pages/GenerateVouchersPage';
import { PlansPage } from './pages/PlansPage';
import { PortalPage } from './pages/PortalPage';
import { PrintReceiptPage } from './pages/PrintReceiptPage';
import { PrintSetupPage } from './pages/PrintSetupPage';
import { PrintSheetPage } from './pages/PrintSheetPage';
import { ReportsPage } from './pages/ReportsPage';
import { RouterFormPage } from './pages/RouterFormPage';
import { RoutersPage } from './pages/RoutersPage';
import { SalesPage } from './pages/SalesPage';
import { SellPage } from './pages/SellPage';
import { StaffPage } from './pages/StaffPage';
import { VouchersPage } from './pages/VouchersPage';

function HomeRedirect() {
  const { profile } = useAuth();
  return <Navigate to={profile ? homePathFor(profile.role) : '/login'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
          <Route element={<RequireRole roles={rolesFor('/staff')} />}>
            <Route path="/staff" element={<StaffPage />} />
          </Route>
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Route>
    </Routes>
  );
}
