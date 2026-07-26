import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import OtpPage from './pages/OtpPage';
import DashboardPage from './pages/DashboardPage';
import LgaPage from './pages/LgaPage';
import WardPage from './pages/WardPage';
import PollingUnitPage from './pages/PollingUnitPage';
import CorrectionsPage from './pages/CorrectionsPage';
import AdminsPage from './pages/AdminsPage';

function RequireAuth({ children }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

function Routed() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/verify" element={<OtpPage />} />
      <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/lga/:lgaId" element={<RequireAuth><LgaPage /></RequireAuth>} />
      <Route path="/lga/:lgaId/ward/:wardId" element={<RequireAuth><WardPage /></RequireAuth>} />
      <Route path="/polling-unit/:id" element={<RequireAuth><PollingUnitPage /></RequireAuth>} />
      <Route
        path="/corrections"
        element={
          <RequireAuth>
            <RequireRole roles={['verifying_admin', 'chief_admin']}>
              <CorrectionsPage />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/admins"
        element={
          <RequireAuth>
            <RequireRole roles={['chief_admin']}>
              <AdminsPage />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to={token ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routed />
      </AuthProvider>
    </BrowserRouter>
  );
}
