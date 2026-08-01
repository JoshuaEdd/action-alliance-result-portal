import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
    <div className="step-content" style={{ paddingTop: 64 }}>
      <h1 style={{ fontSize: 24 }}>Result Portal</h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 32 }}>
        Polling unit agent sign-in
      </p>
      {state?.justRegistered && (
        <p style={{ color: 'var(--field-green-dark)', fontSize: 14, marginBottom: 16 }}>
          Account created — sign in below.
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="identifier">Email or phone number</label>
          <input
            id="identifier"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            minLength={8}
            required
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p style={{ fontSize: 13, marginTop: 16, textAlign: 'center' }}>
        New agent? <Link to="/register">Create an account with your invite code</Link>
      </p>
    </div>
  );
}
