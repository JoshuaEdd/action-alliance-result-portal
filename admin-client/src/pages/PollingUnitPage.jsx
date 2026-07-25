import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Layout from '../components/Layout';
import Breadcrumb from '../components/Breadcrumb';

const PHOTO_LABELS = {
  agent_tag: 'Agent tag',
  result_sheet: 'Result sheet',
  agent_passport: 'Agent passport',
};

export default function PollingUnitPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [pu, setPu] = useState(null);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionField, setCorrectionField] = useState('total_valid_votes');
  const [proposedValue, setProposedValue] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const load = () => api.getPollingUnitDetail(token, id).then(setPu);

  useEffect(() => { load(); }, [token, id]);

  if (!pu) return <Layout><p>Loading…</p></Layout>;

  const hasSubmission = !!pu.status;

  const handleCorrectionSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await api.createCorrectionRequest(token, {
        submissionId: pu.id,
        fieldName: correctionField,
        proposedValue,
        reason,
      });
      setMessage({ type: 'ok', text: 'Correction request submitted for administrator approval.' });
      setShowCorrectionForm(false);
      setProposedValue('');
      setReason('');
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <Breadcrumb
        crumbs={[
          { label: 'Federal Constituency', to: '/dashboard' },
          { label: pu.lga_name, to: '#' },
          { label: pu.ward_name, to: '#' },
          { label: `${pu.pu_name} — PU ${pu.pu_number}`, to: `/polling-unit/${id}` },
        ]}
      />

      <div className="toolbar">
        <h2 style={{ fontSize: 18 }}>{pu.pu_name} — PU {pu.pu_number}</h2>
        {hasSubmission && (
          <a className="btn btn-secondary" href={api.pdfExportUrl(token, id)} target="_blank" rel="noreferrer">
            Export PDF
          </a>
        )}
      </div>

      {!hasSubmission ? (
        <p style={{ color: 'var(--ink-soft)' }}>No accepted result has been submitted for this polling unit yet.</p>
      ) : (
        <>
          <div className="card-grid">
            <StatCard label="Reference" value={pu.reference_number} mono small />
            <StatCard label="Registered voters" value={pu.total_registered_voters} />
            <StatCard label="Accredited voters" value={pu.total_accredited_voters} />
            <StatCard label="Valid votes" value={pu.total_valid_votes} />
            <StatCard label="Invalid votes" value={pu.total_invalid_votes} />
            <StatCard label="Total votes" value={pu.total_votes} />
          </div>

          <div style={{ marginBottom: 24, fontSize: 14, color: 'var(--ink-soft)' }}>
            <div>Submitted by: {pu.submitting_agent_name} ({pu.submitting_agent_phone})</div>
            <div>Captured: {new Date(pu.captured_at).toLocaleString()}</div>
            <div>
              Status: <span className={`status-pill ${pu.status}`}>{pu.status.replace('_', ' ')}</span>
              {pu.gps_flagged && <span className="status-pill flagged" style={{ marginLeft: 6 }}>GPS outside expected radius</span>}
            </div>
          </div>

          <h3 style={{ fontSize: 14 }}>Photos</h3>
          <div className="detail-photo-grid" style={{ marginBottom: 32 }}>
            {['agent_tag', 'result_sheet', 'agent_passport'].map((type) => {
              const photo = pu.photos.find((p) => p.photo_type === type);
              return (
                <div key={type} className="ph">
                  {photo ? `${PHOTO_LABELS[type]}\n(stored, admin-only access)` : `${PHOTO_LABELS[type]}\nnot captured`}
                </div>
              );
            })}
          </div>

          {message && (
            <p className={message.type === 'ok' ? 'error-text' : 'error-text'} style={{ color: message.type === 'ok' ? 'var(--field-green-dark)' : 'var(--error-red)' }}>
              {message.text}
            </p>
          )}

          {!showCorrectionForm ? (
            <button className="btn btn-secondary" onClick={() => setShowCorrectionForm(true)}>
              Request a correction
            </button>
          ) : (
            <form onSubmit={handleCorrectionSubmit} style={{ maxWidth: 420, marginTop: 16 }}>
              <div className="field">
                <label>Field to correct</label>
                <select value={correctionField} onChange={(e) => setCorrectionField(e.target.value)}>
                  <option value="total_registered_voters">Registered voters</option>
                  <option value="total_accredited_voters">Accredited voters</option>
                  <option value="total_valid_votes">Valid votes</option>
                  <option value="total_invalid_votes">Invalid votes</option>
                  <option value="total_votes">Total votes</option>
                </select>
              </div>
              <div className="field">
                <label>Proposed value</label>
                <input value={proposedValue} onChange={(e) => setProposedValue(e.target.value)} required />
              </div>
              <div className="field">
                <label>Reason</label>
                <input value={reason} onChange={(e) => setReason(e.target.value)} required />
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
                The original submission stays unchanged until every administrator approves this request.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit request'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => setShowCorrectionForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </Layout>
  );
}

function StatCard({ label, value, mono, small }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: small ? 15 : 24, fontFamily: mono ? 'var(--font-mono)' : undefined }}>
        {value}
      </div>
    </div>
  );
}
