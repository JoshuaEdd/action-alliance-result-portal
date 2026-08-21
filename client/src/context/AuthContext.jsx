import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // mirrors server JWT_EXPIRES_IN default

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const raw = sessionStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });
  const timeoutRef = useRef(null);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
  }, []);

  // FR-1.5 — auto logout after inactivity
  const resetInactivityTimer = useCallback(() => {
    clearTimeout(timeoutRef.current);
    if (token) timeoutRef.current = setTimeout(logout, SESSION_TIMEOUT_MS);
  }, [token, logout]);

  useEffect(() => {
    if (!token) return;
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, resetInactivityTimer));
    resetInactivityTimer();
    return () => events.forEach((e) => window.removeEventListener(e, resetInactivityTimer));
  }, [token, resetInactivityTimer]);

  const loginPassword = async (identifier, password) => {
    return api.loginPassword(identifier, password); // returns { preAuthToken }
  };

  const verifyOtp = async (preAuthToken, code) => {
    const data = await api.verifyOtp(preAuthToken, code);
    setToken(data.token);
    setUser(data.user);
    sessionStorage.setItem('token', data.token);
    sessionStorage.setItem('user', JSON.stringify(data.user));
    return data;
  };

  // Agent fingerprint sign-in: runs the WebAuthn assertion ceremony and
  // stores the resulting session exactly like the OTP path does.
  const loginBiometric = async (email) => {
    const { options, challengeToken } = await api.webauthnLoginOptions(email);
    const { startAuthentication } = await import('@simplewebauthn/browser');
    let assertion;
    try {
      assertion = await startAuthentication({ optionsJSON: options });
    } catch {
      throw new Error('Fingerprint scan was cancelled or failed. Try again.');
    }
    const data = await api.webauthnLoginVerify(email, challengeToken, assertion);
    setToken(data.token);
    setUser(data.user);
    sessionStorage.setItem('token', data.token);
    sessionStorage.setItem('user', JSON.stringify(data.user));
    return data;
  };

  return (
    <AuthContext.Provider value={{ token, user, loginPassword, verifyOtp, loginBiometric, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
