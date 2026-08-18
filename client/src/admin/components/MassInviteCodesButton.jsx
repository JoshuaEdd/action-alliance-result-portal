import { useState } from 'react';
import { Button } from '@heroui/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Mass invite-code generation at any hierarchy level:
//   scope='all'  → every polling unit in the (state/whole) constituency
//   scope='lga'   → every PU in one local government (lgaId)
//   scope='ward'  → every PU in one ward (wardId)
// Units that already have an agent or a live unused code are skipped.
export default function MassInviteCodesButton({ scope, lgaId, wardId, label, size = 'small' }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.bulkInviteCodes(token, { scope, lgaId, wardId });
      setResult(res); // { requested, created }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button
        className="btn btn-secondary"
        onPress={handleGenerate}
        isDisabled={busy}
        style={size === 'small' ? { minHeight: 32, padding: '0 10px', fontSize: 12 } : undefined}
      >
        {busy ? 'Generating…' : (label || 'Generate invite codes')}
      </Button>
      {result && (
        <div style={{ fontSize: 12, color: 'var(--aa-green-dark)', marginTop: 6 }}>
          Generated {result.created} invite code{result.created === 1 ? '' : 's'} for {result.requested} eligible polling unit{result.requested === 1 ? '' : 's'}.
        </div>
      )}
      {error && <div className="error-text" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}