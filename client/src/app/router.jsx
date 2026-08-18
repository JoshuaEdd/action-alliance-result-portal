import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ErrorBoundary from '../admin/components/ErrorBoundary';
import LoginPage from '../pages/LoginPage';
import OtpPage from '../pages/OtpPage';

import RegisterPage from '../agent/pages/RegisterPage';
import WizardPage from '../agent/pages/WizardPage';
import ConfirmationPage from '../agent/pages/ConfirmationPage';

import DashboardPage from '../admin/pages/DashboardPage';
import LgaPage from '../admin/pages/LgaPage';
import WardPage from '../admin/pages/WardPage';
import PollingUnitPage from '../admin/pages/PollingUnitPage';
import CorrectionsPage from '../admin/pages/CorrectionsPage';
import AdminsPage from '../admin/pages/AdminsPage';

import { SubmissionProvider } from '../agent/context/SubmissionContext';

const ADMIN_ROLES = ['limited_admin', 'verifying_admin', 'chief_admin'];

const homePath = (user) => (user?.role === 'agent' ? '/submit' : '/dashboard');

function RequireAgent({ children }) {
  const { token, user } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (user?.role !== 'agent') return <Navigate to="/dashboard" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { token, user } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (user?.role === 'agent') return <Navigate to="/submit" replace />;
  if (!ADMIN_ROLES.includes(user?.role)) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdminRole({ roles, children }) {
  const { user } = useAuth();
  if (ADMIN_ROLES.includes(user?.role) && !roles.includes(user?.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function Routed() {
  const { token, user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to={homePath(user)} replace /> : <LoginPage />} />
      <Route path="/verify" element={<OtpPage />} />
      <Route path="/register" element={token ? <Navigate to={homePath(user)} replace /> : <RegisterPage />} />

      {/* Agent area */}
      <Route
        element={
          <RequireAgent>
            <SubmissionProvider>
              <Outlet />
            </SubmissionProvider>
          </RequireAgent>
        }
      >
        <Route path="/submit" element={<WizardPage />} />
        <Route path="/confirmation" element={<ConfirmationPage />} />
      </Route>

      {/* Admin area — each page supplies its own Layout */}
      <Route element={<RequireAdmin><Outlet /></RequireAdmin>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/lga/:lgaId" element={<LgaPage />} />
        <Route path="/lga/:lgaId/ward/:wardId" element={<WardPage />} />
        <Route path="/polling-unit/:id" element={<PollingUnitPage />} />
        <Route
          path="/corrections"
          element={
            <RequireAdminRole roles={['verifying_admin', 'chief_admin']}>
              <CorrectionsPage />
            </RequireAdminRole>
          }
        />
        <Route
          path="/admins"
          element={
            <RequireAdminRole roles={['chief_admin']}>
              <AdminsPage />
            </RequireAdminRole>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to={token ? homePath(user) : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routed />
    </BrowserRouter>
  );
}