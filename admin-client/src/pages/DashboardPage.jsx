import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Layout from '../components/Layout';
import Breadcrumb from '../components/Breadcrumb';

export default function DashboardPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [lgas, setLgas] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([api.getSummary(token), api.getLocalGovernments(token)]);
    setSummary(s);
    setLgas(l);
  }, [token]);

  useEffect(() => {
    load();
    // FR-4.13 — near real-time updates without a manual page refresh
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return setResults(null);
    setResults(await api.search(token, query.trim()));
  };

  const goToResult = (r) => {
    if (r.type === 'local_government') navigate(`/lga/${r.id}`);
    if (r.type === 'ward') navigate(`/lga/${r.lga_id}/ward/${r.id}`);
    if (r.type === 'polling_unit') navigate(`/polling-unit/${r.id}`);
  };

  return (
    <Layout>
      <Breadcrumb crumbs={[{ label: 'Federal Constituency', to: '/dashboard' }]} />

      <form className="toolbar" onSubmit={handleSearch}>
        <input
          className="search-input"
          placeholder="Search local government, ward, or polling unit…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-secondary" type="submit">Search</button>
      </form>

      {results && (
        <table className="data-table" style={{ marginBottom: 32 }}>
          <thead><tr><th>Type</th><th>Name</th><th>Location</th></tr></thead>
          <tbody>
            {results.length === 0 && <tr><td colSpan={3}>No matches</td></tr>}
            {results.map((r) => (
              <tr key={`${r.type}-${r.id}`} onClick={() => goToResult(r)}>
                <td>{r.type.replace('_', ' ')}</td>
                <td>{r.name}{r.number ? ` (${r.number})` : ''}</td>
                <td>{[r.ward_name, r.lga_name].filter(Boolean).join(' — ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
            <div className="progress-line">
              <div className="progress-line-fill" style={{ width: `${summary.reportingProgressPct}%` }} />
            </div>
          </div>
        </>
      )}

      <div className="toolbar">
        <h2 style={{ fontSize: 16 }}>Local Governments</h2>
        <button className="btn btn-secondary" onClick={() => downloadCsv(token, 'federal')}>
          Export CSV
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr><th>Local Government</th><th>Reported</th><th className="numeric">Total Votes</th></tr>
        </thead>
        <tbody>
          {lgas.map((lga) => (
            <tr key={lga.id} onClick={() => navigate(`/lga/${lga.id}`)}>
              <td>{lga.name}</td>
              <td>{lga.reported_polling_units} / {lga.total_polling_units}</td>
              <td className="numeric">{lga.total_votes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
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
