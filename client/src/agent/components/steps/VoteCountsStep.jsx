import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useSubmission } from '../../context/SubmissionContext';
import { api } from '../../../api/client';
import ActionBar from '../ActionBar';

export default function VoteCountsStep() {
  const { token } = useAuth();
  const { draft, updateDraft, partyVotes, updatePartyVotes, goNext, goBack } = useSubmission();
  const [parties, setParties] = useState([]);
  const [showAllParties, setShowAllParties] = useState(false);
  const [attemptedContinue, setAttemptedContinue] = useState(false);

  useEffect(() => {
    api.getParties(token).then(setParties).catch(() => {});
  }, [token]);

  const priorityParty = parties.find((p) => p.is_priority);
  const otherParties = parties.filter((p) => !p.is_priority);

  const n = (key) => (draft[key] === '' ? null : Number(draft[key]));

  const totalValidVotes = useMemo(
    () => parties.reduce((sum, p) => sum + (Number(partyVotes[p.id]) || 0), 0),
    [parties, partyVotes]
  );
  const totalInvalidVotes = n('totalInvalidVotes');
  const totalVotes = totalInvalidVotes != null ? totalValidVotes + totalInvalidVotes : null;

  // FR-2.4 — inline validation errors as the agent types, not only at preview
  const errors = useMemo(() => {
    const e = {};
    const registered = n('totalRegisteredVoters');
    const accredited = n('totalAccreditedVoters');

    if (accredited != null && registered != null && accredited > registered) {
      e.totalAccreditedVoters = 'Cannot exceed registered voters';
    }
    if (totalVotes != null && accredited != null && totalVotes > accredited) {
      e.totalVotes = 'Total votes (valid + invalid) cannot exceed accredited voters';
    }
    return e;
  }, [draft, totalVotes]);

  const allPartiesFilled = parties.length > 0 && parties.every((p) => partyVotes[p.id] !== undefined && partyVotes[p.id] !== '');
  const baseFieldsFilled =
    draft.totalRegisteredVoters !== '' && draft.totalAccreditedVoters !== '' && draft.totalInvalidVotes !== '';

  const handleNext = () => {
    if (!allPartiesFilled) {
      setAttemptedContinue(true);
      setShowAllParties(true);
      return;
    }
    goNext();
  };

  return (
    <>
      <div className="step-content">
        <h2>Record the vote counts</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 16 }}>
          Enter figures exactly as they appear on the polling unit result sheet.
        </p>

        <div className="ledger" style={{ marginBottom: 16 }}>
          <div className="ledger-row">
            <span className="ledger-label">Total registered voters</span>
            <input
              type="number" inputMode="numeric" min="0"
              value={draft.totalRegisteredVoters}
              onChange={(e) => updateDraft({ totalRegisteredVoters: e.target.value })}
            />
          </div>
          <div className={`ledger-row ${errors.totalAccreditedVoters ? 'error' : ''}`}>
            <span className="ledger-label">Total accredited voters</span>
            <input
              type="number" inputMode="numeric" min="0"
              value={draft.totalAccreditedVoters}
              onChange={(e) => updateDraft({ totalAccreditedVoters: e.target.value })}
            />
          </div>
          {errors.totalAccreditedVoters && <p className="error-text" style={{ padding: '0 12px 8px' }}>{errors.totalAccreditedVoters}</p>}
        </div>

        {/* Action Alliance is always shown first and prominently — this is
            an AA-operated portal, so its own result is never buried under
            the other 20 parties on the ballot. */}
        {priorityParty && (
          <div
            className="ledger"
            style={{ marginBottom: 12, borderColor: 'var(--field-green)', borderWidth: 2 }}
          >
            <div className="ledger-row">
              <span className="ledger-label" style={{ color: 'var(--field-green-dark)', fontWeight: 700 }}>
                {priorityParty.name} ({priorityParty.abbreviation})
              </span>
              <input
                type="number" inputMode="numeric" min="0"
                value={partyVotes[priorityParty.id] ?? ''}
                onChange={(e) => updatePartyVotes({ [priorityParty.id]: e.target.value })}
                style={{ color: 'var(--field-green-dark)' }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%', marginBottom: 12 }}
          onClick={() => setShowAllParties((v) => !v)}
        >
          {showAllParties ? 'Hide other parties' : `Enter votes for other ${otherParties.length} parties`}
        </button>

        {attemptedContinue && !allPartiesFilled && (
          <p className="error-text" style={{ marginBottom: 12 }}>
            Every party on the result sheet needs a vote count (enter 0 where a party has none).
          </p>
        )}

        {showAllParties && (
          <div className="ledger" style={{ marginBottom: 16 }}>
            {otherParties.map((p) => (
              <div key={p.id} className="ledger-row">
                <span className="ledger-label">{p.name} ({p.abbreviation})</span>
                <input
                  type="number" inputMode="numeric" min="0"
                  value={partyVotes[p.id] ?? ''}
                  onChange={(e) => updatePartyVotes({ [p.id]: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}

        <div className="ledger">
          <div className="ledger-row derived">
            <span className="ledger-label">Total valid votes (auto)</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 20 }}>{totalValidVotes}</span>
          </div>
          <div className="ledger-row">
            <span className="ledger-label">Total invalid votes</span>
            <input
              type="number" inputMode="numeric" min="0"
              value={draft.totalInvalidVotes}
              onChange={(e) => updateDraft({ totalInvalidVotes: e.target.value })}
            />
          </div>
          <div className={`ledger-row derived ${errors.totalVotes ? 'error' : ''}`}>
            <span className="ledger-label">Total votes cast (auto)</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 20 }}>{totalVotes ?? '—'}</span>
          </div>
        </div>
        {errors.totalVotes && <p className="error-text" style={{ marginTop: 8 }}>{errors.totalVotes}</p>}
      </div>
      <ActionBar onBack={goBack} onNext={handleNext} nextDisabled={!baseFieldsFilled || Object.keys(errors).length > 0} />
    </>
  );
}
