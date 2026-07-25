import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Layout from '../components/Layout';
import Breadcrumb from '../components/Breadcrumb';

export default function CorrectionsPage() {
  const { token } = useAuth();
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = () => api.getCorrectionRequests(token).then(setRequests);

  useEffect(() => { load(); }, [token]);

  const decide = async (id, approved) => {
    setBusyId(id);
    try {
      await api.decideCorrectionRequest(token, id, approved);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Layout>
      <Breadcrumb crumbs={[{ label: 'Correction Requests', to: '/corrections' }]} />

      <table className="data-table">
        <thead>
          <tr>
            <th>Reference</th>
            <th>Field</th>
            <th>Original → Proposed</th>
            <th>Reason</th>
            <th>Approvals</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requests.length === 0 && (
            <tr><td colSpan={7} style={{ color: 'var(--ink-soft)' }}>No correction requests.</td></tr>
          )}
          {requests.map((r) => (
            <tr key={r.id}>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{r.reference_number}</td>
              <td>{r.field_name.replace(/_/g, ' ')}</td>
              <td>{r.original_value} → {r.proposed_value}</td>
              <td>{r.reason}</td>
              <td>{r.approvals} / {r.admins_required}</td>
              <td><span className={`status-pill ${r.status === 'pending' ? 'correction_pending' : r.status === 'approved' ? 'submitted' : 'flagged'}`}>{r.status}</span></td>
              <td>
                {r.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }} disabled={busyId === r.id} onClick={() => decide(r.id, true)}>
                      Approve
                    </button>
                    <button className="btn btn-danger" style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }} disabled={busyId === r.id} onClick={() => decide(r.id, false)}>
                      Reject
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
