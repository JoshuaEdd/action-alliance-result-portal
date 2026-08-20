import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Input, Button } from '@heroui/react';
import { useAuth } from '../context/AuthContext';
import AaLogo from '../components/AaLogo';

export default function LoginPage() {
  const { loginPassword } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
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
          Account created — sign in below.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
      <p className="text-sm text-center text-[var(--muted)]">
        New agent? <Link to="/register" className="text-[var(--accent)] font-medium">Create an account with your invite code</Link>
      </p>
      </div>
    </div>
  );
}