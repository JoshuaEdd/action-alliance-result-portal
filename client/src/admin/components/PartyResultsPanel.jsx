import { useState } from 'react';
import { Button, Table } from '@heroui/react';

// AA is always visible; the other ~20 parties are opt-in per the
// requirement that "view of other parties' result should be optional" —
// admins see Action Alliance's standing at a glance, and can expand for
// the full sheet when they need it.
export default function PartyResultsPanel({ parties, leadingParty, title = 'Party results' }) {
  const [showAll, setShowAll] = useState(false);

  if (!parties || parties.length === 0) return null;

  const priorityParty = parties.find((p) => p.is_priority);
  const otherParties = parties.filter((p) => !p.is_priority);

  return (
    <div style={{ marginBottom: 32 }}>
      <div className="toolbar">
        <h3 style={{ fontSize: 14 }}>{title}</h3>
      </div>

      {leadingParty && (
        <div
          className="stat-card"
          style={{
            marginBottom: 12,
            borderColor: 'var(--aa-deep)',
            borderWidth: 2,
            background: '#EAF3FB',
          }}
        >
          <div className="label">Leading party</div>
          <div className="value" style={{ fontSize: 18, color: 'var(--aa-deep-dark)' }}>
            {leadingParty.name} ({leadingParty.abbreviation}) — {leadingParty.votes} votes
          </div>
        </div>
      )}

      {priorityParty && (
        <table className="data-table" style={{ marginBottom: 12 }}>
          <tbody>
            <tr style={{ background: '#EAF3FB' }}>
              <td style={{ fontWeight: 700, color: 'var(--aa-deep-dark)' }}>
                {priorityParty.name} ({priorityParty.abbreviation})
              </td>
              <td className="numeric" style={{ fontWeight: 700, color: 'var(--aa-deep-dark)' }}>
                {priorityParty.votes}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <Button className="btn btn-primary" onPress={() => setShowAll((v) => !v)}>
        {showAll ? 'Hide other parties' : `Show other ${otherParties.length} parties`}
      </Button>

      {showAll && (
        <Table>
          <Table.Content className="data-table" style={{ marginTop: 12 }} selectionMode="none" aria-label="Other parties">
            <Table.Header>
              <Table.Column>Party</Table.Column>
              <Table.Column className="numeric">Votes</Table.Column>
            </Table.Header>
            <Table.Body>
              {otherParties.map((p) => (
                <Table.Row key={p.party_id} id={p.party_id}>
                  <Table.Cell>{p.name} ({p.abbreviation})</Table.Cell>
                  <Table.Cell className="numeric">{p.votes}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table>
      )}
    </div>
  );
}
