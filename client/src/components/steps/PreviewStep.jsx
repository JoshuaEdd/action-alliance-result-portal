import { useState } from 'react';
import { useSubmission } from '../../context/SubmissionContext';
import ActionBar from '../ActionBar';

const SLOTS = [
  { key: 'agentTagPhoto', label: 'Agent tag' },
  { key: 'resultSheetPhoto', label: 'Result sheet' },
  { key: 'agentPassportPhoto', label: 'Passport photo' },
];

export default function PreviewStep() {
  const { draft, photos, goBack, submit, submitting, submitError } = useSubmission();
  const [previewStage, setPreviewStage] = useState(0); // 0 = data, 1 = photos

  const dataRows = [
    ['Registered voters', draft.totalRegisteredVoters],
    ['Accredited voters', draft.totalAccreditedVoters],
    ['Valid votes', draft.totalValidVotes],
    ['Invalid votes', draft.totalInvalidVotes],
    ['Total votes', draft.totalVotes],
    ['Agent name', draft.submittingAgentName],
    ['Agent phone', draft.submittingAgentPhone],
  ];

  return (
    <>
      <div className="step-content">
        <h2>{previewStage === 0 ? 'Review entered data' : 'Review photos'}</h2>

        {previewStage === 0 ? (
          <div className="ledger">
            {dataRows.map(([label, value]) => (
              <div key={label} className="ledger-row">
                <span className="ledger-label">{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value || '—'}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {SLOTS.map((s) => (
              <div key={s.key}>
                <div className="camera-frame" style={{ aspectRatio: '3/4' }}>
                  {photos[s.key] && <img src={URL.createObjectURL(photos[s.key])} alt={s.label} />}
                </div>
                <p style={{ fontSize: 11, textAlign: 'center', color: 'var(--ink-soft)' }}>{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {submitError && <p className="error-text">{submitError}</p>}
      </div>

      {previewStage === 0 ? (
        <ActionBar onBack={goBack} onNext={() => setPreviewStage(1)} nextLabel="Review photos" />
      ) : (
        <ActionBar
          onBack={() => setPreviewStage(0)}
          onNext={submit}
          nextLabel={submitting ? 'Submitting…' : 'Submit result'}
          nextDisabled={submitting}
        />
      )}
    </>
  );
}
