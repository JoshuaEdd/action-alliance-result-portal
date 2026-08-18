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
    <div className="max-w-sm mx-auto pt-24 px-4" style={{ paddingTop: '4rem' }}>
      <div className="flex items-center gap-3 mb-6">
        <AaLogo size={56} />
        <div>
          <h1 className="text-xl m-0" style={{ color: 'var(--aa-green-dark)' }}>Action Alliance</h1>
          <div className="text-[11px] tracking-[0.06em] uppercase" style={{ fontFamily: 'var(--font-mono)', color: 'var(--aa-gold-dark)' }}>
            Result Portal sign-in
          </div>
        </div>
      </div>
      {state?.justRegistered && (
        <p className="text-sm mb-4" style={{ color: 'var(--field-green-dark)' }}>
          Account created — sign in below.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Email or phone number"
          type="text"
          value={identifier}
          onValueChange={setIdentifier}
          isRequired
          autoComplete="username"
          variant="bordered"
          size="lg"
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onValueChange={setPassword}
          isRequired
          autoComplete="current-password"
          variant="bordered"
          size="lg"
        />
        {error && <p className="error-text">{error}</p>}
        <Button type="submit" color="primary" fullWidth size="lg" isLoading={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="text-sm mt-4 text-center">
        New agent? <Link to="/register">Create an account with your invite code</Link>
      </p>
    </div>
  );
}