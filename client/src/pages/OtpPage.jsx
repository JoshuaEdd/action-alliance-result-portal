import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function OtpPage() {
  const { verifyOtp } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!state?.preAuthToken) {
    navigate('/login', { replace: true });
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await verifyOtp(state.preAuthToken, code);
      navigate('/submit', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="step-content" style={{ paddingTop: 64 }}>
      <h1 style={{ fontSize: 24 }}>Enter verification code</h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 32 }}>
        A 6-digit code was sent to your {state.deliveredTo === 'email' ? 'email' : 'phone'}.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="code">Verification code</label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading || code.length !== 6} style={{ width: '100%' }}>
          {loading ? 'Verifying…' : 'Verify & continue'}
        </button>
      </form>
    </div>
  );
}
