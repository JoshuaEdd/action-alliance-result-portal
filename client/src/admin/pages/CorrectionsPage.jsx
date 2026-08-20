import { useEffect, useState } from 'react';
import { Button, Table } from '@heroui/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import Layout from '../components/Layout';
import Breadcrumbs from '../components/Breadcrumbs';

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
      <div className="admin-sticky-header">
        <Breadcrumbs crumbs={[{ label: 'Correction Requests', to: '/corrections' }]} />
        <div className="page-heading">
          <div className="page-kicker">Review Queue</div>
          <h1>Correction Requests</h1>
        </div>
      </div>

      <Table>
        <Table.Content className="data-table" selectionMode="none" aria-label="Correction requests">
          <Table.Header>
            <Table.Column>Reference</Table.Column>
            <Table.Column>Field</Table.Column>
            <Table.Column>Original → Proposed</Table.Column>
            <Table.Column>Reason</Table.Column>
            <Table.Column>Approvals</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column>{''}</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => 'No correction requests.'}>
            {requests.map((r) => (
              <Table.Row key={r.id} id={r.id}>
                <Table.Cell style={{ fontFamily: 'var(--font-mono)' }}>{r.reference_number}</Table.Cell>
                <Table.Cell>{r.field_name.replace(/_/g, ' ')}</Table.Cell>
                <Table.Cell>{r.original_value} → {r.proposed_value}</Table.Cell>
                <Table.Cell>{r.reason}</Table.Cell>
                <Table.Cell>{r.approvals} / {r.admins_required}</Table.Cell>
                <Table.Cell><span className={`status-pill ${r.status === 'pending' ? 'correction_pending' : r.status === 'approved' ? 'submitted' : 'flagged'}`}>{r.status}</span></Table.Cell>
                <Table.Cell>
                  {r.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button className="btn btn-primary" style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }} isDisabled={busyId === r.id} onPress={() => decide(r.id, true)}>
                        Approve
                      </Button>
                      <Button className="btn btn-danger" style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }} isDisabled={busyId === r.id} onPress={() => decide(r.id, false)}>
                        Reject
                      </Button>
                    </div>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table>
    </Layout>
  );
}
