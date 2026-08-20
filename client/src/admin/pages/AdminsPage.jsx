import { useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Chip, Input, ListBox, Select, Table } from '@heroui/react';
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
  const [sortDescriptor, setSortDescriptor] = useState({ column: 'full_name', direction: 'ascending' });

  const load = () => api.getAdmins(token).then(setAdmins);

  useEffect(() => { load(); }, [token]);

  const initials = (name) =>
    name.split(' ').map((n) => n[0] || '').join('').slice(0, 2).toUpperCase();

  const sortedAdmins = useMemo(() => {
    return [...admins].sort((a, b) => {
      const col = sortDescriptor.column;
      let x = a[col];
      let y = b[col];
      if (typeof x === 'boolean') {
        x = x ? 1 : 0;
        y = y ? 1 : 0;
      } else {
        x = String(x ?? '');
        y = String(y ?? '');
      }
      const cmp = x < y ? -1 : x > y ? 1 : 0;
      return sortDescriptor.direction === 'ascending' ? cmp : -cmp;
    });
  }, [admins, sortDescriptor]);

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
      <div className="admin-sticky-header">
        <Breadcrumbs crumbs={[{ label: 'Administrators', to: '/admins' }]} />
        <div className="page-heading">
          <div className="page-kicker">User Management</div>
          <div className="flex items-center justify-between gap-4">
            <h1 style={{ margin: 0 }}>Administrator Accounts</h1>
            <Button className="btn btn-primary" onPress={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'Add administrator'}
            </Button>
          </div>
        </div>
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
        <Table.ScrollContainer>
        <Table.Content
          className="data-table min-w-[800px]"
          selectionMode="none"
          aria-label="Administrators"
          sortDescriptor={sortDescriptor}
          onSortChange={setSortDescriptor}
        >
          <Table.Header>
            <Table.Column allowsSorting isRowHeader id="full_name">
              {({ sortDirection }) => (
                <Table.SortableColumnHeader sortDirection={sortDirection}>Name</Table.SortableColumnHeader>
              )}
            </Table.Column>
            <Table.Column allowsSorting id="role">
              {({ sortDirection }) => (
                <Table.SortableColumnHeader sortDirection={sortDirection}>Role</Table.SortableColumnHeader>
              )}
            </Table.Column>
            <Table.Column allowsSorting id="is_active">
              {({ sortDirection }) => (
                <Table.SortableColumnHeader sortDirection={sortDirection}>Status</Table.SortableColumnHeader>
              )}
            </Table.Column>
            <Table.Column className="text-end">{''}</Table.Column>
          </Table.Header>
          <Table.Body>
            {sortedAdmins.map((a) => (
              <Table.Row key={a.id} id={a.id}>
                <Table.Cell>
                  <div className="flex items-center gap-3">
                    <Avatar size="sm">
                      <Avatar.Fallback>{initials(a.full_name)}</Avatar.Fallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{a.full_name}</span>
                      <span className="text-xs text-muted">{a.email}</span>
                    </div>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <Chip size="sm" variant="soft" color="secondary">{a.role.replace('_', ' ')}</Chip>
                </Table.Cell>
                <Table.Cell>
                  <Chip size="sm" variant="soft" color={a.is_active ? 'success' : 'danger'}>
                    {a.is_active ? 'enabled' : 'revoked'}
                  </Chip>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex items-center gap-2 justify-end">
                    <Button variant="secondary" size="sm" onPress={() => toggleActive(a)}>
                      {a.is_active ? 'Revoke' : 'Reactivate'}
                    </Button>
                    {!a.is_active && (
                      <Button variant="danger-soft" size="sm" onPress={() => handleDelete(a)} isDisabled={a.id === user?.id}>
                        Delete
                      </Button>
                    )}
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Layout>
  );
}
