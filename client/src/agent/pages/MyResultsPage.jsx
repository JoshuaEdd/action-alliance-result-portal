import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import AgentHeader from '../components/AgentHeader';

const fmt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

// SEC-4 entry point: the agent browses their own submitted results and opens
// one to request a correction. Only results that still stand (not superseded,
// with no pending / approved correction) offer the request action.
function statusLabel(sub) {
  if (sub.supersededBy) return { className: 'submitted', text: 'Corrected' };
  if (sub.latestCorrectionStatus === 'pending') return { className: 'correction_pending', text: 'Correction pending' };
  if (sub.latestCorrectionStatus === 'rejected') return { className: 'flagged', text: 'Correction rejected' };
  if (sub.status === 'flagged') return { className: 'flagged', text: 'Flagged for review' };
  if (sub.status === 'under_review') return { className: 'pending', text: 'Under review' };
  return { className: 'submitted', text: 'Submitted' };
}

export default function MyResultsPage() {
  const { token } = useAuth();
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getMySubmissions(token)
      .then((d) => setResults(Array.isArray(d) ? d : []))
      .catch((err) => setError(err.message));
  }, [token]);

  const canRequest = (sub) =>
    !sub.supersededBy &&
    !sub.isDuplicate &&
    sub.latestCorrectionStatus !== 'pending' &&
    sub.latestCorrectionStatus !== 'approved';

  return (
    <>
      <AgentHeader />
      <div className="step-content">
        <div className="admin-sticky-header" style={{ padding: '18px 0' }}>
          <div className="page-heading">
            <div className="page-kicker">SEC-4 — controlled corrections only</div>
            <h2 style={{ margin: 0 }}>My Submitted Results</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--ink-soft)', fontSize: 13 }}>
              Your results are official records and can&apos;t be edited. If one contains a mistake, you can request a
              correction that an administrator will review before anything changes.
            </p>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        {results === null ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>Loading your results…</p>
        ) : results.length === 0 ? (
          <div className="card">
            <p style={{ fontSize: 14, margin: 0 }}>
              You haven&apos;t submitted any results yet.
            </p>
            <Link className="btn btn-primary" style={{ marginTop: 16 }} to="/submit">
              Submit a result
            </Link>
          </div>
        ) : (
          <div className="result-list" style={{ display: 'grid', gap: 12 }}>
            {results.map((sub) => {
              const flag = statusLabel(sub);
              return (
                <div key={sub.id} className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <span className="reference-number" style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>{sub.referenceNumber}</span>
                    <span className={`status-pill ${flag.className}`}>{flag.text}</span>
                  </div>
                  <div style={{ fontSize: 14, marginTop: 8 }}>
                    {sub.pollingUnit.name} — PU {sub.pollingUnit.number}
                    <div style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{sub.ward} › {sub.lga} · submitted {fmt(sub.createdAt)}</div>
                  </div>
                  <div className="ledger" style={{ marginTop: 12 }}>
                    {[
                      ['Registered', sub.totals.registered],
                      ['Accredited', sub.totals.accredited],
                      ['Valid', sub.totals.valid],
                      ['Invalid', sub.totals.invalid],
                      ['Total', sub.totals.total],
                    ].map(([label, value]) => (
                      <div key={label} className="ledger-row">
                        <span className="ledger-label">{label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                  <Link className="btn btn-secondary" style={{ marginTop: 14, width: '100%' }} to={`/correction/${sub.referenceNumber}`}>
                    {canRequest(sub) ? 'Request a correction' : 'View status'}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}