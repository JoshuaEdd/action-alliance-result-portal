import { useEffect, useState } from 'react';
import { Button, Table } from '@heroui/react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import Layout from '../components/Layout';
import Breadcrumbs from '../components/Breadcrumbs';

const fmt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

// Number of figures (headline counts + per-party votes) that differ between
// the original and proposed snapshots — a quick severity read from the queue.
function changesCount(r) {
  let n = 0;
  const diff = (a, b) => Number(a) !== Number(b);
  if (r.original_registered != null && diff(r.original_registered, r.proposed_registered)) n += 1;
  if (r.original_accredited != null && diff(r.original_accredited, r.proposed_accredited)) n += 1;
  if (r.original_invalid != null && diff(r.original_invalid, r.proposed_invalid)) n += 1;
  const o = r.original_party_votes || {};
  const p = r.proposed_party_votes || {};
  for (const key of new Set([...Object.keys(o), ...Object.keys(p)])) {
    if (diff(o[key] || 0, p[key] || 0)) n += 1;
  }
  return n;
}

export default function CorrectionsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const load = () => {
    setLoadError(null);
    api
      .getCorrectionRequests(token)
      .then((d) => setRequests(Array.isArray(d) ? d : []))
      .catch((err) => setLoadError(err.message));
  };

  useEffect(() => { load(); }, [token]);

  return (
    <Layout>
      <div className="admin-sticky-header">
        <Breadcrumbs crumbs={[{ label: 'Correction Requests', to: '/corrections' }]} />
        <div className="page-heading">
          <div className="page-kicker">Review Queue</div>
          <h1>Correction Requests</h1>
        </div>
      </div>

      {loadError && (
        <p className="error-text">{loadError}</p>
      )}

      <Table>
        <Table.Content className="data-table" selectionMode="none" aria-label="Correction requests">
          <Table.Header>
            <Table.Column>Reference</Table.Column>
            <Table.Column>Polling Unit</Table.Column>
            <Table.Column>Agent</Table.Column>
            <Table.Column>Requested</Table.Column>
            <Table.Column>Reason</Table.Column>
            <Table.Column>Changes</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column>{''}</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => 'No correction requests.'}>
            {requests.map((r) => (
              <Table.Row key={r.id} id={r.id}>
                <Table.Cell style={{ fontFamily: 'var(--font-mono)' }}>{r.reference_number}</Table.Cell>
                <Table.Cell>
                  {r.pu_name} — PU {r.pu_number}
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{r.ward_name} › {r.lga_name}</div>
                </Table.Cell>
                <Table.Cell>{r.agent_name}</Table.Cell>
                <Table.Cell>{fmt(r.created_at)}</Table.Cell>
                <Table.Cell>{r.reason.length > 60 ? `${r.reason.slice(0, 60)}…` : r.reason}</Table.Cell>
                <Table.Cell>{changesCount(r)}</Table.Cell>
                <Table.Cell>
                  <span className={`status-pill ${r.status === 'pending' ? 'correction_pending' : r.status === 'approved' ? 'submitted' : 'flagged'}`}>
                    {r.status}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <Button
                    className="btn btn-primary"
                    style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
                    onPress={() => navigate(`/corrections/${r.id}`)}
                  >
                    {r.status === 'pending' ? 'Review' : 'View'}
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table>
    </Layout>
  );
}