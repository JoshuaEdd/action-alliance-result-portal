import { useNavigate } from 'react-router-dom';
import { useSubmission } from '../context/SubmissionContext';

export default function ConfirmationPage() {
  const { submitResult } = useSubmission();
  const navigate = useNavigate();

  if (!submitResult) {
    navigate('/submit', { replace: true });
    return null;
  }

  const queued = submitResult.queued;

  return (
    <div className="step-content" style={{ paddingTop: 64, textAlign: 'center' }}>
      <div
        className={`status-pill ${queued ? 'pending' : 'submitted'}`}
        style={{ marginBottom: 24 }}
      >
        {queued ? 'Pending Upload' : 'Submitted'}
      </div>

      {queued ? (
        <>
          <h2>Saved on this device</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
            No connection right now. This result is queued and will upload automatically
            as soon as a signal is available — no need to resubmit.
          </p>
        </>
      ) : (
        <>
          <h2>Result received</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 16 }}>
            Reference number — keep this for your records.
          </p>
          <div className="reference-number">{submitResult.referenceNumber}</div>
        </>
      )}

      <button
        className="btn btn-primary"
        style={{ marginTop: 40, width: '100%' }}
        onClick={() => navigate('/submit')}
      >
        Done
      </button>
    </div>
  );
}
