import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { Layout } from './components/Layout';
import { homePathFor, rolesFor } from './lib/nav';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PlannedPage } from './pages/PlannedPage';
import { RouterFormPage } from './pages/RouterFormPage';
import { RoutersPage } from './pages/RoutersPage';
import { StaffPage } from './pages/StaffPage';

function HomeRedirect() {
  const { profile } = useAuth();
  return <Navigate to={profile ? homePathFor(profile.role) : '/login'} replace />;
}

const PLANNED: { path: string; title: string; phase: number; features: string[] }[] = [
  {
    path: '/sell',
    title: 'Sell',
    phase: 6,
    features: ['One big button per plan with price, duration and stock', 'Code shown full-screen after each sale', 'Print receipt and Sell another'],
  },
  {
    path: '/vouchers',
    title: 'Vouchers',
    phase: 4,
    features: ['Generate voucher batches from a plan', 'Push vouchers to the router', 'Search and filter vouchers', 'Print A4 card sheets (Phase 5)'],
  },
  {
    path: '/plans',
    title: 'Plans',
    phase: 4,
    features: ['Price, time allowed, validity, speed and data limit', 'Plan colour for cards and Sell buttons', 'Profiles synced to every router'],
  },
  {
    path: '/sales',
    title: 'Sales',
    phase: 6,
    features: ["Today's sales by default, with filters", 'Mark printed cards as sold', 'Void a sale within 24 hours (admin)'],
  },
  {
    path: '/reports',
    title: 'Reports',
    phase: 8,
    features: ['Daily, weekly and monthly tabs', 'By plan, seller and site', 'Print and CSV export'],
  },
  {
    path: '/active-users',
    title: 'Active Users',
    phase: 7,
    features: ['Users online per router, updated live', 'Time and data used', 'Disconnect (admin)'],
  },
];

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<HomeRedirect />} />
          <Route element={<RequireRole roles={rolesFor('/dashboard')} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>
          <Route element={<RequireRole roles={rolesFor('/routers')} />}>
            <Route path="/routers" element={<RoutersPage />} />
            <Route path="/routers/new" element={<RouterFormPage />} />
            <Route path="/routers/:id/edit" element={<RouterFormPage />} />
          </Route>
          <Route element={<RequireRole roles={rolesFor('/staff')} />}>
            <Route path="/staff" element={<StaffPage />} />
          </Route>
          {PLANNED.map((page) => (
            <Route key={page.path} element={<RequireRole roles={rolesFor(page.path)} />}>
              <Route path={page.path} element={<PlannedPage title={page.title} phase={page.phase} features={page.features} />} />
            </Route>
          ))}
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Route>
    </Routes>
  );
}
