import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SubmissionProvider } from './context/SubmissionContext';
import LoginPage from './pages/LoginPage';
import OtpPage from './pages/OtpPage';
import WizardPage from './pages/WizardPage';
import ConfirmationPage from './pages/ConfirmationPage';

function RequireAuth({ children }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function Routed() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/submit" replace /> : <LoginPage />} />
      <Route path="/verify" element={<OtpPage />} />
      <Route
        element={
          <RequireAuth>
            <SubmissionProvider>
              <Outlet />
            </SubmissionProvider>
          </RequireAuth>
        }
      >
        <Route path="/submit" element={<WizardPage />} />
        <Route path="/confirmation" element={<ConfirmationPage />} />
      </Route>
      <Route path="*" element={<Navigate to={token ? '/submit' : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="app-shell">
          <Routed />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
