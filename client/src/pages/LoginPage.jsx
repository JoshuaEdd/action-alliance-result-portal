import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Input, Button } from '@heroui/react';
import { useAuth } from '../context/AuthContext';
import AaLogo from '../components/AaLogo';

// Two sign-in surfaces, one page:
//   Agent  — email + device fingerprint (WebAuthn), no passwords
//   Admin  — email/phone + password + OTP (unchanged flow)
export default function LoginPage() {
  const { loginPassword, loginBiometric } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [tab, setTab] = useState('agent');

  // agent form
  const [email, setEmail] = useState(state?.registeredEmail || '');
  const [bioLoading, setBioLoading] = useState(false);

  // admin form
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState(null);

  const handleBiometric = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Enter the email you registered with');
      return;
    }
    setBioLoading(true);
    try {
      await loginBiometric(email.trim());
      navigate('/submit');
    } catch (err) {
      setError(err.message);
    } finally {
      setBioLoading(false);
    }
  };

  const handlePassword = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { preAuthToken, deliveredTo } = await loginPassword(identifier, password);
      navigate('/verify', { state: { preAuthToken, deliveredTo } });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] shadow-lg ring-1 ring-black/5 p-6 pt-8 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <AaLogo size={56} />
          <div>
            <h1 className="text-xl m-0 font-bold" style={{ color: 'var(--aa-green-dark)', fontFamily: 'Poppins, var(--font-display)' }}>
              Action Alliance
            </h1>
            <div className="text-[11px] tracking-[0.06em] uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--font-mono)' }}>
              Result Portal sign-in
            </div>
          </div>
        </div>

        {state?.justRegistered && (
          <p className="text-sm text-[var(--success-foreground)]">
            Account created — scan your fingerprint to sign in.
          </p>
        )}

        {/* Role tabs */}
        <div className="flex rounded-xl bg-[var(--paper)] p-1 gap-1">
          {[
            ['agent', 'Agent'],
            ['admin', 'Administrator'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setError(null);
              }}
              className={`flex-1 min-h-[40px] rounded-lg text-sm font-semibold transition-all ${
                tab === key
                  ? 'bg-white shadow text-[var(--aa-green-dark)]'
                  : 'text-[var(--muted)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'agent' ? (
          <form onSubmit={handleBiometric} className="flex flex-col gap-4">
            <div>
              <label htmlFor="bioEmail" className="block text-sm font-medium mb-1.5">
                Registered email
              </label>
              <Input
                id="bioEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username webauthn"
                placeholder="you@example.com"
                required
                fullWidth
              />
            </div>
            {error && <p className="error-text">{error}</p>}
            <Button type="submit" variant="primary" fullWidth disabled={bioLoading}>
              {bioLoading ? 'Waiting for fingerprint…' : 'Sign in with fingerprint'}
            </Button>
            <p className="text-xs text-center text-[var(--muted)]">
              Your device will prompt for your fingerprint, face, or PIN.
            </p>
          </form>
        ) : (
          <form onSubmit={handlePassword} className="flex flex-col gap-4">
            <div>
              <label htmlFor="identifier" className="block text-sm font-medium mb-1.5">
                Email or phone number
              </label>
              <Input
                id="identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                required
                fullWidth
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1.5">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                fullWidth
              />
            </div>
            {error && <p className="error-text">{error}</p>}
            <Button type="submit" variant="primary" fullWidth>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}

        <p className="text-sm text-center text-[var(--muted)]">
          New agent? <Link to="/register" className="text-[var(--accent)] font-medium">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
