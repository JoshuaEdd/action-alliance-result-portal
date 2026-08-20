import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Table } from '@heroui/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import Layout from '../components/Layout';
import Breadcrumbs from '../components/Breadcrumbs';
import PartyResultsPanel from '../components/PartyResultsPanel';
import MassInviteCodesButton from '../components/MassInviteCodesButton';
import { downloadXlsx } from './DashboardPage';

export default function WardPage() {
  const { lgaId, wardId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [lgaName, setLgaName] = useState('');
  const [wardName, setWardName] = useState('');
  const [pollingUnits, setPollingUnits] = useState([]);
  const [partyResults, setPartyResults] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const openWardPdf = async () => {
    setExportingPdf(true);
    try {
      const blob = await api.exportWardPdf(token, wardId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error(err);
    } finally {
      setExportingPdf(false);
    }
  };

  useEffect(() => {
    api.getLocalGovernments(token).then((all) => {
      const found = all.find((l) => l.id === lgaId);
      if (found) setLgaName(found.name);
    });
    api.getWards(token, lgaId).then((all) => {
      const found = all.find((w) => w.id === wardId);
      if (found) setWardName(`${found.name} — Ward ${found.ward_number}`);
    });
    api.getPollingUnits(token, wardId).then(setPollingUnits);
    api.getPartyResults(token, 'ward', wardId).then(setPartyResults);
  }, [token, lgaId, wardId]);

  return (
    <Layout>
      <div className="admin-sticky-header">
        <Breadcrumbs
          crumbs={[
            { label: 'Ahiazu Federal Constituency', to: '/dashboard' },
            { label: lgaName || 'Local Government', to: `/lga/${lgaId}` },
            { label: wardName || 'Ward', to: `/lga/${lgaId}/ward/${wardId}` },
          ]}
        />
        <div className="page-heading">
          <div className="page-kicker">Ward Results</div>
          <h1>{wardName || 'Ward'}</h1>
        </div>
      </div>

      {partyResults && (
        <PartyResultsPanel
          parties={partyResults.parties}
          leadingParty={partyResults.leadingParty}
          title={`${wardName || 'This ward'} — party results`}
        />
      )}

      <div className="toolbar">
        <h2 style={{ fontSize: 16 }}>Polling Units</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <MassInviteCodesButton scope="ward" wardId={wardId} label="Generate codes (this ward)" />
          <Button className="btn btn-secondary" style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }} isDisabled={exportingPdf} onPress={openWardPdf}>
            {exportingPdf ? 'Exporting…' : 'Export PDF'}
          </Button>
          <Button className="btn btn-secondary" style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }} onPress={() => downloadXlsx(token, 'ward', wardId)}>
            Export Excel (.xlsx)
          </Button>
        </div>
      </div>

      <Table>
        <Table.Content className="data-table" selectionMode="none" aria-label="Polling units" onRowAction={(key) => navigate(`/polling-unit/${key}`)}>
          <Table.Header>
            <Table.Column>Polling Unit</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column className="numeric">Total Votes</Table.Column>
          </Table.Header>
          <Table.Body>
            {pollingUnits.map((pu) => (
              <Table.Row key={pu.id} id={pu.id}>
                <Table.Cell>{pu.name} — PU {pu.pu_number}</Table.Cell>
                <Table.Cell>
                  <span className={`status-pill ${pu.status || 'na'}`}>
                    {pu.status ? pu.status.replace('_', ' ') : 'not reported'}
                  </span>
                  {pu.gps_flagged && (
                    <span className="status-pill flagged" style={{ marginLeft: 6 }}>GPS flag</span>
                  )}
                </Table.Cell>
                <Table.Cell className="numeric">{pu.total_votes ?? '—'}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table>
    </Layout>
  );
}
