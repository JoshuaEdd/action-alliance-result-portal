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
    <div className="step-content confirm-wrap">
      {queued ? (
        <>
          <div className="confirm-ring ring-pending">
            <span className="confirm-icon">⇪</span>
          </div>
          <div className={`status-pill pending`} style={{ marginBottom: 24 }}>Pending Upload</div>
          <h2>Saved on this device</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
            No connection right now. This result is queued and will upload automatically
            as soon as a signal is available — no need to resubmit.
          </p>
        </>
      ) : (
        <>
          <div className="confirm-ring ring-success">
            <svg viewBox="0 0 52 52" className="check-svg" aria-hidden="true">
              <circle className="check-circle" cx="26" cy="26" r="24" fill="none" />
              <path className="check-mark" fill="none" d="M14 27l8 8 16-17" />
            </svg>
          </div>
          <div className={`status-pill submitted`} style={{ marginBottom: 24 }}>Submitted</div>
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
