import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Layout from '../components/Layout';
import Breadcrumb from '../components/Breadcrumb';

const ROLES = ['limited_admin', 'verifying_admin', 'chief_admin'];

export default function AdminsPage() {
  const { token } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', role: 'limited_admin', temporaryPassword: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = () => api.getAdmins(token).then(setAdmins);

  useEffect(() => { load(); }, [token]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createAdmin(token, form);
      setForm({ fullName: '', email: '', role: 'limited_admin', temporaryPassword: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (admin) => {
    await api.updateAdmin(token, admin.id, { isActive: !admin.is_active });
    await load();
  };

  return (
    <Layout>
      <Breadcrumb crumbs={[{ label: 'Administrators', to: '/admins' }]} />

      <div className="toolbar">
        <h2 style={{ fontSize: 16 }}>Administrator accounts</h2>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'Add administrator'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ maxWidth: 420, marginBottom: 32 }}>
          <div className="field">
            <label>Full name</label>
            <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="field">
            <label>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Temporary password</label>
            <input
              type="text"
              value={form.temporaryPassword}
              onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })}
              placeholder="Shared with the admin out-of-band"
              required
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>
      )}

      <table className="data-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {admins.map((a) => (
            <tr key={a.id}>
              <td>{a.full_name}</td>
              <td>{a.email}</td>
              <td>{a.role.replace('_', ' ')}</td>
              <td>
                <span className={`status-pill ${a.is_active ? 'submitted' : 'flagged'}`}>
                  {a.is_active ? 'active' : 'revoked'}
                </span>
              </td>
              <td>
                <button className="btn btn-secondary" style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }} onClick={() => toggleActive(a)}>
                  {a.is_active ? 'Revoke' : 'Reactivate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
