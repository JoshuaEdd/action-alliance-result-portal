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

export default function LgaPage() {
  const { lgaId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [lgaName, setLgaName] = useState('');
  const [wards, setWards] = useState([]);
  const [partyResults, setPartyResults] = useState(null);

  useEffect(() => {
    api.getLocalGovernments(token).then((all) => {
      const found = all.find((l) => l.id === lgaId);
      if (found) setLgaName(found.name);
    });
    api.getWards(token, lgaId).then(setWards);
    api.getPartyResults(token, 'lga', lgaId).then(setPartyResults);
  }, [token, lgaId]);

  return (
    <Layout>
      <div className="admin-sticky-header">
        <Breadcrumbs
          crumbs={[
            { label: 'Ahiazu Federal Constituency', to: '/dashboard' },
            { label: lgaName || 'Local Government', to: `/lga/${lgaId}` },
          ]}
        />
        <div className="page-heading">
          <div className="page-kicker">Local Government Area</div>
          <h1>{lgaName || 'Local Government'}</h1>
        </div>
      </div>

      {partyResults && (
        <PartyResultsPanel
          parties={partyResults.parties}
          leadingParty={partyResults.leadingParty}
          title={`${lgaName || 'This local government'} — party results`}
        />
      )}

      <div className="toolbar">
        <h2 style={{ fontSize: 16 }}>Wards</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <MassInviteCodesButton scope="lga" lgaId={lgaId} label="Generate codes (this LGA)" />
          <Button className="btn btn-secondary" style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }} onPress={() => downloadXlsx(token, 'lga', lgaId)}>
            Export Excel (.xlsx)
          </Button>
        </div>
      </div>

      <Table>
        <Table.Content className="data-table" selectionMode="none" aria-label="Wards" onRowAction={(key) => navigate(`/lga/${lgaId}/ward/${key}`)}>
          <Table.Header>
            <Table.Column>Ward</Table.Column>
            <Table.Column>Reported</Table.Column>
            <Table.Column>Leading Party</Table.Column>
            <Table.Column className="numeric">Total Votes</Table.Column>
          </Table.Header>
          <Table.Body>
            {wards.map((w) => (
              <Table.Row key={w.id} id={w.id}>
                <Table.Cell>{w.name} — Ward {w.ward_number}</Table.Cell>
                <Table.Cell>{w.reported_polling_units} / {w.total_polling_units}</Table.Cell>
                <Table.Cell>{w.leadingParty ? `${w.leadingParty.abbreviation} (${w.leadingParty.votes})` : '—'}</Table.Cell>
                <Table.Cell className="numeric">{w.total_votes}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table>
    </Layout>
  );
}
