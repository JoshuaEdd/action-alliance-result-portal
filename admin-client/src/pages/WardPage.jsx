import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Layout from '../components/Layout';
import Breadcrumb from '../components/Breadcrumb';
import { downloadCsv } from './DashboardPage';

export default function WardPage() {
  const { lgaId, wardId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [lgaName, setLgaName] = useState('');
  const [wardName, setWardName] = useState('');
  const [pollingUnits, setPollingUnits] = useState([]);

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
  }, [token, lgaId, wardId]);

  return (
    <Layout>
      <Breadcrumb
        crumbs={[
          { label: 'Federal Constituency', to: '/dashboard' },
          { label: lgaName || 'Local Government', to: `/lga/${lgaId}` },
          { label: wardName || 'Ward', to: `/lga/${lgaId}/ward/${wardId}` },
        ]}
      />

      <div className="toolbar">
        <h2 style={{ fontSize: 16 }}>Polling Units</h2>
        <button className="btn btn-secondary" onClick={() => downloadCsv(token, 'ward', wardId)}>
          Export CSV
        </button>
      </div>

      <table className="data-table">
        <thead>
          <tr><th>Polling Unit</th><th>Status</th><th className="numeric">Total Votes</th></tr>
        </thead>
        <tbody>
          {pollingUnits.map((pu) => (
            <tr key={pu.id} onClick={() => navigate(`/polling-unit/${pu.id}`)}>
              <td>{pu.name} — PU {pu.pu_number}</td>
              <td>
                <span className={`status-pill ${pu.status || 'na'}`}>
                  {pu.status ? pu.status.replace('_', ' ') : 'not reported'}
                </span>
                {pu.gps_flagged && (
                  <span className="status-pill flagged" style={{ marginLeft: 6 }}>GPS flag</span>
                )}
              </td>
              <td className="numeric">{pu.total_votes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
