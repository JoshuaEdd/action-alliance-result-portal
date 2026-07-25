import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Layout from '../components/Layout';
import Breadcrumb from '../components/Breadcrumb';
import { downloadCsv } from './DashboardPage';

export default function LgaPage() {
  const { lgaId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [lgaName, setLgaName] = useState('');
  const [wards, setWards] = useState([]);

  useEffect(() => {
    api.getLocalGovernments(token).then((all) => {
      const found = all.find((l) => l.id === lgaId);
      if (found) setLgaName(found.name);
    });
    api.getWards(token, lgaId).then(setWards);
  }, [token, lgaId]);

  return (
    <Layout>
      <Breadcrumb
        crumbs={[
          { label: 'Federal Constituency', to: '/dashboard' },
          { label: lgaName || 'Local Government', to: `/lga/${lgaId}` },
        ]}
      />

      <div className="toolbar">
        <h2 style={{ fontSize: 16 }}>Wards</h2>
        <button className="btn btn-secondary" onClick={() => downloadCsv(token, 'lga', lgaId)}>
          Export CSV
        </button>
      </div>

      <table className="data-table">
        <thead>
          <tr><th>Ward</th><th>Reported</th><th className="numeric">Total Votes</th></tr>
        </thead>
        <tbody>
          {wards.map((w) => (
            <tr key={w.id} onClick={() => navigate(`/lga/${lgaId}/ward/${w.id}`)}>
              <td>{w.name} — Ward {w.ward_number}</td>
              <td>{w.reported_polling_units} / {w.total_polling_units}</td>
              <td className="numeric">{w.total_votes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
