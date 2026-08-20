import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Input, Button } from '@heroui/react';
import { useAuth } from '../context/AuthContext';
import AaLogo from '../components/AaLogo';

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
      const data = await verifyOtp(state.preAuthToken, code);
      const isAgent = data.user?.role === 'agent';
      navigate(isAgent ? '/submit' : '/dashboard', { replace: true });
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
          <AaLogo size={48} />
          <h1 className="text-xl m-0" style={{ color: 'var(--aa-green-dark)' }}>Enter verification code</h1>
        </div>
      <p className="text-sm text-[var(--muted)]">
        A 6-digit code was sent to your {state.deliveredTo === 'email' ? 'email' : 'phone'}.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="code" className="block text-sm font-medium mb-1.5">
            Verification code
          </label>
          <Input
            id="code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6-digit code"
            required
            fullWidth
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <Button type="submit" variant="primary" fullWidth isDisabled={loading || code.length !== 6}>
          {loading ? 'Verifying…' : 'Verify & continue'}
        </Button>
      </form>
      </div>
    </div>
  );
}