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
    <div className="max-w-sm mx-auto pt-32 px-4" style={{ paddingTop: '8rem' }}>
      <div className="flex items-center gap-3 mb-6">
        <AaLogo size={48} />
        <h1 className="text-xl m-0" style={{ color: 'var(--aa-green-dark)' }}>Enter verification code</h1>
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-soft)' }}>
        A 6-digit code was sent to your {state.deliveredTo === 'email' ? 'email' : 'phone'}.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Verification code"
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onValueChange={(v) => setCode(v.replace(/\D/g, ''))}
          isRequired
          variant="bordered"
          size="lg"
          description="Enter the 6-digit code from your email or phone."
        />
        {error && <p className="error-text">{error}</p>}
        <Button
          type="submit"
          color="primary"
          fullWidth
          size="lg"
          isLoading={loading}
          isDisabled={code.length !== 6}
        >
          {loading ? 'Verifying…' : 'Verify & continue'}
        </Button>
      </form>
    </div>
  );
}