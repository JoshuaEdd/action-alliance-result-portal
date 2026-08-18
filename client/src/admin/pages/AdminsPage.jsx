import { useEffect, useState } from 'react';
import { Button, Input, ListBox, Select, Table } from '@heroui/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import Layout from '../components/Layout';
import Breadcrumbs from '../components/Breadcrumbs';

const ROLES = ['limited_admin', 'verifying_admin', 'chief_admin'];

export default function AdminsPage() {
  const { token, user } = useAuth();
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

  const handleDelete = async (admin) => {
    // Permanent — only shown when the role has been revoked already.
    if (!window.confirm(`Delete ${admin.full_name} permanently? Their role must already be revoked.`)) return;
    try {
      await api.deleteAdmin(token, admin.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Layout>
      <Breadcrumbs crumbs={[{ label: 'Administrators', to: '/admins' }]} />

      <div className="toolbar">
        <h2 style={{ fontSize: 16 }}>Administrator accounts</h2>
        <Button className="btn btn-primary" onPress={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'Add administrator'}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ maxWidth: 420, marginBottom: 32 }}>
          <div className="field">
            <label>Full name</label>
            <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
          </div>
          <div className="field">
            <label>Email</label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="field">
            <label>Role</label>
            <Select
              className="field-select"
              aria-label="Role"
              selectedKey={form.role}
              onSelectionChange={(key) => setForm({ ...form, role: String(key) })}
            >
              <Select.Trigger className="field-select-trigger">
                <Select.Value className="field-select-value" />
                <Select.Indicator className="field-select-indicator" />
              </Select.Trigger>
              <Select.Popover className="field-select-popover">
                <ListBox aria-label="Role" className="field-select-listbox">
                  {ROLES.map((r) => (
                    <ListBox.Item key={r} id={r} className="field-select-option">{r.replace('_', ' ')}</ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          <div className="field">
            <label>Temporary password</label>
            <Input
              type="text"
              value={form.temporaryPassword}
              onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })}
              placeholder="Shared with the admin out-of-band"
              required
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <Button className="btn btn-primary" type="submit" isDisabled={submitting}>
            {submitting ? 'Creating…' : 'Create account'}
          </Button>
        </form>
      )}

      <Table>
        <Table.Content className="data-table" selectionMode="none" aria-label="Administrators">
          <Table.Header>
            <Table.Column>Name</Table.Column>
            <Table.Column>Email</Table.Column>
            <Table.Column>Role</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column>{''}</Table.Column>
          </Table.Header>
          <Table.Body>
            {admins.map((a) => (
              <Table.Row key={a.id} id={a.id}>
                <Table.Cell>{a.full_name}</Table.Cell>
                <Table.Cell>{a.email}</Table.Cell>
                <Table.Cell>{a.role.replace('_', ' ')}</Table.Cell>
                <Table.Cell>
                  <span className={`status-pill ${a.is_active ? 'submitted' : 'flagged'}`}>
                    {a.is_active ? 'enabled' : 'revoked'}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Button
                      className="btn btn-secondary"
                      style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                      onPress={() => toggleActive(a)}
                    >
                      {a.is_active ? 'Revoke' : 'Reactivate'}
                    </Button>
                    {!a.is_active && (
                      <Button
                        className="btn btn-danger"
                        style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                        onPress={() => handleDelete(a)}
                        isDisabled={a.id === user?.id}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table>
    </Layout>
  );
}
