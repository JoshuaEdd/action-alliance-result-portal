import { useEffect, useState } from 'react';
import { Button, Table } from '@heroui/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

export default function InviteCodesPanel({ pollingUnitId }) {
  const { token } = useAuth();
  const [codes, setCodes] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const load = () => api.getInviteCodes(token, pollingUnitId).then(setCodes);

  useEffect(() => { load(); }, [token, pollingUnitId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await api.createInviteCode(token, pollingUnitId);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (id) => {
    await api.revokeInviteCode(token, id);
    await load();
  };

  const copy = (code, id) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const hasUnusedCode = codes.some((c) => !c.used_at && (!c.expires_at || new Date(c.expires_at) > new Date()));

  return (
    <div style={{ marginBottom: 32 }}>
      <div className="toolbar">
        <h3 style={{ fontSize: 14 }}>Agent invite codes</h3>
        <Button className="btn btn-primary" onPress={handleGenerate} isDisabled={generating || hasUnusedCode}>
          {generating ? 'Generating…' : 'Generate code'}
        </Button>
      </div>
      {hasUnusedCode && (
        <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
          An unused code already exists for this polling unit — revoke it before generating a new one.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}

      {codes.length === 0 ? (
        <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>No codes generated yet.</p>
      ) : (
        <Table>
          <Table.Content className="data-table" selectionMode="none" aria-label="Invite codes">
            <Table.Header>
              <Table.Column>Code</Table.Column>
              <Table.Column>Status</Table.Column>
              <Table.Column>{''}</Table.Column>
            </Table.Header>
            <Table.Body>
              {codes.map((c) => (
                <Table.Row key={c.id} id={c.id}>
                  <Table.Cell style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{c.code}</Table.Cell>
                  <Table.Cell>
                    {c.used_at ? (
                      <span className="status-pill submitted">used by {c.used_by_name}</span>
                    ) : c.expires_at && new Date(c.expires_at) < new Date() ? (
                      <span className="status-pill flagged">expired</span>
                    ) : (
                      <span className="status-pill correction_pending">unused</span>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {!c.used_at && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button
                          className="btn btn-secondary"
                          style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}
                          onPress={() => copy(c.code, c.id)}
                        >
                          {copiedId === c.id ? 'Copied' : 'Copy'}
                        </Button>
                        <Button
                          className="btn btn-danger"
                          style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}
                          onPress={() => handleRevoke(c.id)}
                        >
                          Revoke
                        </Button>
                      </div>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table>
      )}
    </div>
  );
}
