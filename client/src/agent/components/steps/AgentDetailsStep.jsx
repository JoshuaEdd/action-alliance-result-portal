import { useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { api } from '../../../api/client';
import { useSubmission } from '../../context/SubmissionContext';
import ActionBar from '../ActionBar';

// Agents are never asked for their name or phone again (req) — this step
// confirms what the server has on file from registration, and feeds those
// exact values into the submission preview so the record is consistent.
export default function AgentDetailsStep() {
  const { token } = useAuth();
  const { draft, updateDraft, goNext, goBack } = useSubmission();
  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getMe(token)
      .then((me) => {
        if (cancelled) return;
        setProfile(me);
        // Stamp the registration profile into the draft the moment it loads —
        // the preview/summary shows these, and the server validates the same.
        updateDraft({
          submittingAgentName: me.fullName || draft.submittingAgentName,
          submittingAgentPhone: me.phoneNumber || draft.submittingAgentPhone,
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token, updateDraft]);

  const row = (label, value) => (
    <div className="ledger-row">
      <span className="ledger-label">{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value || '—'}</span>
    </div>
  );

  return (
    <>
      <div className="step-content">
        <h2>Agent details</h2>
        <p className="step-hint">
          Taken from your registration — no need to enter them again. Contact an administrator if anything is wrong.
        </p>

        {loadError && <p className="error-text">{loadError}</p>}

        <div className="ledger">
          {row('Full name', profile?.fullName)}
          {row('Email', profile?.email)}
          {row('Phone number', profile?.phoneNumber)}
        </div>
      </div>
      {/* Always enabled: the profile exists by this point (the account is
          signed-in and approved), so there is nothing left to ask for. */}
      <ActionBar onBack={goBack} onNext={goNext} />
    </>
  );
}