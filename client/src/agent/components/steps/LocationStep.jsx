import { useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useSubmission } from '../../context/SubmissionContext';
import { api } from '../../../api/client';
import ActionBar from '../ActionBar';

// The polling unit is fixed at registration time by the admin-issued
// invite code (see auth.js's /register route) — this step just confirms
// it rather than letting the agent pick, so there's nothing to re-lock.
export default function LocationStep() {
  const { token } = useAuth();
  const { goNext } = useSubmission();
  const [pu, setPu] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getMyPollingUnit(token).then(setPu).catch((err) => setError(err.message));
  }, [token]);

  return (
    <>
      <div className="step-content">
        <h2>Confirm your polling unit</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 20 }}>
          This is fixed to your account from registration and can't be changed here —
          contact an administrator if it's wrong.
        </p>

        {error && <p className="error-text">{error}</p>}

        {pu && (
          <div className="ledger">
            <div className="ledger-row">
              <span className="ledger-label">Local Government</span>
              <span style={{ fontWeight: 600 }}>{pu.lga_name}</span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Ward</span>
              <span style={{ fontWeight: 600 }}>{pu.ward_name}</span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Polling Unit</span>
              <span style={{ fontWeight: 600 }}>{pu.name} (PU {pu.pu_number})</span>
            </div>
          </div>
        )}
      </div>
      <ActionBar showBack={false} onNext={goNext} nextDisabled={!pu} />
    </>
  );
}
