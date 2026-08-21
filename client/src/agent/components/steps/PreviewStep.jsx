import { useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useSubmission } from '../../context/SubmissionContext';
import { api } from '../../../api/client';
import ActionBar from '../ActionBar';

const SLOTS = [
  { key: 'agentTagPhoto', label: 'Agent tag' },
  { key: 'resultSheetPhoto', label: 'Result sheet' },
  { key: 'agentPassportPhoto', label: 'Passport photo' },
];

export default function PreviewStep() {
  const { token } = useAuth();
  const { draft, partyVotes, photos, photoMeta, goBack, submit, submitting, submitError } = useSubmission();
  const [previewStage, setPreviewStage] = useState(0); // 0 = data, 1 = parties, 2 = photos
  const [parties, setParties] = useState([]);

  useEffect(() => {
    api.getParties(token).then(setParties).catch(() => {});
  }, [token]);

  const totalValidVotes = parties.reduce((sum, p) => sum + (Number(partyVotes[p.id]) || 0), 0);
  const totalInvalidVotes = Number(draft.totalInvalidVotes) || 0;

  const dataRows = [
    ['Registered voters', draft.totalRegisteredVoters],
    ['Accredited voters', draft.totalAccreditedVoters],
    ['Total valid votes', totalValidVotes],
    ['Invalid votes', totalInvalidVotes],
    ['Total votes', totalValidVotes + totalInvalidVotes],
    ['Agent name', draft.submittingAgentName],
    ['Agent phone', draft.submittingAgentPhone],
  ];

  return (
    <>
      <div className="step-content">
        <h2>
          {previewStage === 0 ? 'Review entered data' : previewStage === 1 ? 'Review party votes' : 'Review photos'}
        </h2>

        {previewStage === 0 && (
          <div className="ledger">
            {dataRows.map(([label, value]) => (
              <div key={label} className="ledger-row">
                <span className="ledger-label">{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value || '—'}</span>
              </div>
            ))}
          </div>
        )}

        {previewStage === 1 && (
          <div className="ledger">
            {parties.map((p) => (
              <div key={p.id} className="ledger-row">
                <span
                  className="ledger-label"
                  style={p.is_priority ? { color: 'var(--field-green-dark)', fontWeight: 700 } : undefined}
                >
                  {p.name} ({p.abbreviation})
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {partyVotes[p.id] ?? '0'}
                </span>
              </div>
            ))}
          </div>
        )}

        {previewStage === 2 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {SLOTS.map((s) => (
              <div key={s.key}>
                <div className="camera-frame" style={{ aspectRatio: '3/4' }}>
                  {photos[s.key] && <img src={URL.createObjectURL(photos[s.key])} alt={s.label} />}
                </div>
                <p style={{ fontSize: 11, textAlign: 'center', color: 'var(--ink-soft)' }}>{s.label}</p>
                {photoMeta[s.key] && (
                  <p className="capture-time" style={{ textAlign: 'center' }}>
                    {new Date(photoMeta[s.key]).toLocaleTimeString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {submitError && <p className="error-text">{submitError}</p>}
      </div>

      {previewStage === 0 && (
        <ActionBar onBack={goBack} onNext={() => setPreviewStage(1)} nextLabel="Review party votes" />
      )}
      {previewStage === 1 && (
        <ActionBar onBack={() => setPreviewStage(0)} onNext={() => setPreviewStage(2)} nextLabel="Review photos" />
      )}
      {previewStage === 2 && (
        <ActionBar
          onBack={() => setPreviewStage(1)}
          onNext={submit}
          nextLabel={submitting ? 'Submitting…' : 'Submit result'}
          nextDisabled={submitting}
        />
      )}
    </>
  );
}
