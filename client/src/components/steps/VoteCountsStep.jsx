import { useMemo } from 'react';
import { useSubmission } from '../../context/SubmissionContext';
import ActionBar from '../ActionBar';

const FIELDS = [
  { key: 'totalRegisteredVoters', label: 'Total registered voters' },
  { key: 'totalAccreditedVoters', label: 'Total accredited voters' },
  { key: 'totalValidVotes', label: 'Total valid votes' },
  { key: 'totalInvalidVotes', label: 'Total invalid votes' },
  { key: 'totalVotes', label: 'Total votes cast', derived: true },
];

export default function VoteCountsStep() {
  const { draft, updateDraft, goNext, goBack } = useSubmission();

  const n = (key) => (draft[key] === '' ? null : Number(draft[key]));

  // FR-2.4 — inline validation errors as the agent types, not only at preview
  const errors = useMemo(() => {
    const e = {};
    const registered = n('totalRegisteredVoters');
    const accredited = n('totalAccreditedVoters');
    const valid = n('totalValidVotes');
    const invalid = n('totalInvalidVotes');
    const total = n('totalVotes');

    if (accredited != null && registered != null && accredited > registered) {
      e.totalAccreditedVoters = 'Cannot exceed registered voters';
    }
    if (valid != null && invalid != null && total != null && total !== valid + invalid) {
      e.totalVotes = `Should equal valid + invalid (${valid + invalid})`;
    }
    if (total != null && accredited != null && total > accredited) {
      e.totalVotes = e.totalVotes || 'Cannot exceed accredited voters';
    }
    return e;
  }, [draft]);

  const allFilled = FIELDS.every((f) => draft[f.key] !== '' && draft[f.key] !== undefined);
  const canContinue = allFilled && Object.keys(errors).length === 0;

  return (
    <>
      <div className="step-content">
        <h2>Record the vote counts</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 16 }}>
          Enter figures exactly as they appear on the polling unit result sheet.
        </p>

        <div className="ledger">
          {FIELDS.map((f) => (
            <div
              key={f.key}
              className={`ledger-row ${f.derived ? 'derived' : ''} ${errors[f.key] ? 'error' : ''}`}
            >
              <span className="ledger-label">{f.label}</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={draft[f.key]}
                onChange={(e) => updateDraft({ [f.key]: e.target.value })}
                aria-label={f.label}
              />
            </div>
          ))}
        </div>
        {Object.values(errors).map((msg, i) => (
          <p key={i} className="error-text" style={{ marginTop: 8 }}>{msg}</p>
        ))}
      </div>
      <ActionBar onBack={goBack} onNext={goNext} nextDisabled={!canContinue} />
    </>
  );
}
