import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Label, ProgressBar, SearchField, Table } from '@heroui/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import Layout from '../components/Layout';
import Breadcrumbs from '../components/Breadcrumbs';
import PartyResultsPanel from '../components/PartyResultsPanel';
import MassInviteCodesButton from '../components/MassInviteCodesButton';
import AaLogo from '../../components/AaLogo';

export default function DashboardPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [lgas, setLgas] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);

  const load = useCallback(async () => {
    try {
      const s = await api.getSummary(token);
      setSummary(s);
    } catch {
      // keep prior data; the 15s poll retries
    }
    try {
      const l = await api.getLocalGovernments(token);
      setLgas(l);
    } catch {
      // keep prior data
    }
  }, [token]);

  useEffect(() => {
    load();
    // FR-4.13 — near real-time updates without a manual page refresh
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const runSearch = async (value) => {
    const q = String(value ?? '').trim();
    if (!q) return setResults(null);
    setResults(await api.search(token, q));
  };

  const goToResult = (r) => {
    if (r.type === 'local_government') navigate(`/lga/${r.id}`);
    if (r.type === 'ward') navigate(`/lga/${r.lga_id}/ward/${r.id}`);
    if (r.type === 'polling_unit') navigate(`/polling-unit/${r.id}`);
  };

  return (
    <Layout>
      <div className="admin-sticky-header">
        <Breadcrumbs crumbs={[{ label: 'Ahiazu Federal Constituency', to: '/dashboard' }]} showBack={false} />

        <div className="page-heading aa-dashboard-heading">
          <AaLogo size={56} />
          <div>
            <div className="page-kicker">Action Alliance — Result Portal</div>
            <h1>Ahiazu Federal Constituency</h1>
            <p>Compiled election result statement for the constituency.</p>
          </div>
        </div>
      </div>

      <div className="w-full max-w-xl mb-6">
        <SearchField
          name="global-search"
          value={query}
          onChange={setQuery}
          onSubmit={runSearch}
          onClear={() => setResults(null)}
          aria-label="Search local government, ward, or polling unit"
        >
          <Label className="text-sm font-medium text-foreground block mb-1.5">
            Search local government, ward, or polling unit
          </Label>
          <div className="flex items-center gap-2">
            <SearchField.Group className="flex-1">
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search…" />
              <SearchField.ClearButton />
            </SearchField.Group>
            <Button variant="primary" onPress={() => runSearch(query)}>
              Search
            </Button>
          </div>
        </SearchField>
      </div>

      {results && (
        <Table>
          <Table.Content className="data-table" style={{ marginBottom: 32 }} selectionMode="none" aria-label="Search results" onRowAction={(key) => goToResult(results[Number(key)])}>
            <Table.Header>
              <Table.Column>Type</Table.Column>
              <Table.Column>Name</Table.Column>
              <Table.Column>Location</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => 'No matches'}>
              {results.map((r, i) => (
                <Table.Row key={`${r.type}-${r.id}`} id={i}>
                  <Table.Cell>{r.type.replace('_', ' ')}</Table.Cell>
                  <Table.Cell>{r.name}{r.number ? ` (${r.number})` : ''}</Table.Cell>
                  <Table.Cell>{[r.ward_name, r.lga_name].filter(Boolean).join(' — ')}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table>
      )}

      {summary && (
        <>
          <div className="card-grid">
            <StatCard label="Registered voters" value={summary.total_registered_voters} />
            <StatCard label="Accredited voters" value={summary.total_accredited_voters} />
            <StatCard label="Valid votes" value={summary.total_valid_votes} />
            <StatCard label="Invalid votes" value={summary.total_invalid_votes} />
            <StatCard label="Total votes" value={summary.total_votes} />
          </div>

          <div className="stat-card" style={{ marginBottom: 32 }}>
            <div className="label">Reporting progress</div>
            <div className="value">
              {summary.polling_units_reported} / {summary.totalPollingUnits} PUs ({summary.reportingProgressPct}%)
            </div>
            <ProgressBar.Root className="progress-root" value={summary.reportingProgressPct} maxValue={100} aria-label="Reporting progress">
              <ProgressBar.Track className="progress-track">
                <ProgressBar.Fill className="progress-fill" />
              </ProgressBar.Track>
            </ProgressBar.Root>
          </div>

          <PartyResultsPanel parties={summary.parties} leadingParty={summary.leadingParty} title="Ahiazu Federal Constituency — party results" />
        </>
      )}

      <div className="toolbar">
        <h2 style={{ fontSize: 16 }}>Local Governments</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <MassInviteCodesButton scope="all" label="Generate invite codes (all PUs)" />
          <Button className="btn btn-secondary" style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }} onPress={() => downloadXlsx(token, 'federal')}>
            Export Excel (.xlsx)
          </Button>
        </div>
      </div>
      <Table>
        <Table.Content className="data-table" selectionMode="none" aria-label="Local governments" onRowAction={(key) => navigate(`/lga/${key}`)}>
          <Table.Header>
            <Table.Column>Local Government</Table.Column>
            <Table.Column>Reported</Table.Column>
            <Table.Column>Leading Party</Table.Column>
            <Table.Column className="numeric">Total Votes</Table.Column>
          </Table.Header>
          <Table.Body>
            {lgas.map((lga) => (
              <Table.Row key={lga.id} id={lga.id}>
                <Table.Cell>{lga.name}</Table.Cell>
                <Table.Cell>{lga.reported_polling_units} / {lga.total_polling_units}</Table.Cell>
                <Table.Cell>{lga.leadingParty ? `${lga.leadingParty.abbreviation} (${lga.leadingParty.votes})` : '—'}</Table.Cell>
                <Table.Cell className="numeric">{lga.total_votes}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table>
    </Layout>
  );
}

function StatCard({ label, value }) {
  return (
    <Card className="stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </Card>
  );
}

export async function downloadCsv(token, level, id) {
  const blob = await api.exportCsv(token, level, id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `results-${level}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadXlsx(token, level, id) {
  const blob = await api.exportXlsx(token, level, id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `results-${level}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
