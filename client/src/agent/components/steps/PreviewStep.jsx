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

const fmt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

export default function PreviewStep() {
  const { token } = useAuth();
  const { draft, partyVotes, photos, photoPreviews, photoMeta, gps, goBack, submit, submitting, submitError } = useSubmission();
  const [previewStage, setPreviewStage] = useState(0); // 0 = data, 1 = parties, 2 = photos
  const [parties, setParties] = useState([]);

  useEffect(() => {
    api.getParties(token).then(setParties).catch(() => {});
  }, [token]);

  // photoPreviews are the data: URLs minted at shutter press and kept in
  // context; the displayed image is exactly the captured frame (matches the
  // blob that is uploaded with the submission).
  const totalValidVotes = parties.reduce((sum, p) => sum + (Number(partyVotes[p.id]) || 0), 0);
  const totalInvalidVotes = Number(draft.totalInvalidVotes) || 0;

  const capturePlace = gps?.placeName || gps?.approximatePlace || (gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : null);

  const dataRows = [
    ['Registered voters', draft.totalRegisteredVoters],
    ['Accredited voters', draft.totalAccreditedVoters],
    ['Total valid votes', totalValidVotes],
    ['Invalid votes', totalInvalidVotes],
    ['Total votes', totalValidVotes + totalInvalidVotes],
    ['Agent name', draft.submittingAgentName],
    ['Agent phone', draft.submittingAgentPhone],
    ['Capture place', capturePlace],
    ['Captured at', gps ? fmt(gps.capturedAt) : null],
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
          <div style={{ marginBottom: 8 }}>
            <span className="chip chip-ok">Location: {capturePlace || 'No location (blocked)'}</span>{' '}
            {gps && <span className="chip">Captured {fmt(gps.capturedAt)}</span>}
          </div>
        )}

        {previewStage === 2 && (
          <div className="preview-photos">
            {SLOTS.map((s) => (
              <div className="preview-photo" key={s.key}>
                <div className="camera-frame preview-frame">
                  {photoPreviews[s.key] ? (
                    <img src={photoPreviews[s.key]} alt={s.label} />
                  ) : (
                    <span className="preview-empty">{s.label}</span>
                  )}
                </div>
                <div className="preview-photo-meta">
                  <span className="preview-photo-label">{s.label}</span>
                  <span className="capture-time">
                    {photoMeta[s.key] ? fmt(photoMeta[s.key]) : 'No timestamp'}
                  </span>
                </div>
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