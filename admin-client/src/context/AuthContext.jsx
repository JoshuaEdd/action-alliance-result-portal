import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem('admin_token'));
  const [user, setUser] = useState(() => {
    const raw = sessionStorage.getItem('admin_user');
    return raw ? JSON.parse(raw) : null;
  });
  const timeoutRef = useRef(null);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    sessionStorage.removeItem('admin_token');
    sessionStorage.removeItem('admin_user');
  }, []);

  const resetInactivityTimer = useCallback(() => {
    clearTimeout(timeoutRef.current);
    if (token) timeoutRef.current = setTimeout(logout, SESSION_TIMEOUT_MS); // FR-1.5 equivalent for admins
  }, [token, logout]);

  useEffect(() => {
    if (!token) return;
    const events = ['mousedown', 'keydown', 'scroll'];
    events.forEach((e) => window.addEventListener(e, resetInactivityTimer));
    resetInactivityTimer();
    return () => events.forEach((e) => window.removeEventListener(e, resetInactivityTimer));
  }, [token, resetInactivityTimer]);

  const loginPassword = (identifier, password) => api.loginPassword(identifier, password);

  const verifyOtp = async (preAuthToken, code) => {
    const data = await api.verifyOtp(preAuthToken, code);
    setToken(data.token);
    setUser(data.user);
    sessionStorage.setItem('admin_token', data.token);
    sessionStorage.setItem('admin_user', JSON.stringify(data.user));
    return data;
  };

  return (
    <AuthContext.Provider value={{ token, user, loginPassword, verifyOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
