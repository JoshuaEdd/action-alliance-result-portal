import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useSubmission } from '../../context/SubmissionContext';
import { api } from '../../../api/client';
import ActionBar from '../ActionBar';

// One tappable card per party. The +/- steppers make one-handed entry fast
// in the field; the numeric input stays for direct typing. AA (priority
// party) gets a brand-gradient hero card so its result is never buried.
function PartyCard({ name, abbreviation, value, onChange, hero = false }) {
  const bump = (delta) => {
    const current = Number(value) || 0;
    const next = Math.max(0, current + delta);
    onChange(String(next));
  };
  return (
    <div className={`party-card ${hero ? 'party-hero' : ''}`}>
      <div className="party-card-head">
        <span className={`party-abbr ${hero ? 'party-abbr-hero' : ''}`}>{abbreviation}</span>
        <span className="party-name">{name}</span>
      </div>
      <div className="party-entry">
        <button type="button" className="stepper-btn" onClick={() => bump(-1)} aria-label={`Decrease ${abbreviation}`}>
          −
        </button>
        <input
          type="number" inputMode="numeric" min="0" placeholder="0"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${name} votes`}
        />
        <button type="button" className="stepper-btn stepper-btn-add" onClick={() => bump(1)} aria-label={`Increase ${abbreviation}`}>
          +
        </button>
      </div>
    </div>
  );
}

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
        <p className="step-hint">
          Enter figures exactly as they appear on the polling unit result sheet.
        </p>

        <div className="card">
          <div className="tally-row">
            <span className="tally-label">Registered voters</span>
            <input
              type="number" inputMode="numeric" min="0"
              value={draft.totalRegisteredVoters}
              onChange={(e) => updateDraft({ totalRegisteredVoters: e.target.value })}
            />
          </div>
          <div className={`tally-row ${errors.totalAccreditedVoters ? 'error' : ''}`}>
            <span className="tally-label">Accredited voters</span>
            <input
              type="number" inputMode="numeric" min="0"
              value={draft.totalAccreditedVoters}
              onChange={(e) => updateDraft({ totalAccreditedVoters: e.target.value })}
            />
          </div>
          {errors.totalAccreditedVoters && <p className="error-text" style={{ padding: '0 16px 10px' }}>{errors.totalAccreditedVoters}</p>}
        </div>

        {/* Action Alliance is always shown first and prominently — this is
            an AA-operated portal, so its own result is never buried under
            the other 20 parties on the ballot. */}
        {priorityParty && (
          <PartyCard
            hero
            name={priorityParty.name}
            abbreviation={priorityParty.abbreviation}
            value={partyVotes[priorityParty.id] ?? ''}
            onChange={(v) => updatePartyVotes({ [priorityParty.id]: v })}
          />
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
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            {otherParties.map((p) => (
              <PartyCard
                key={p.id}
                name={p.name}
                abbreviation={p.abbreviation}
                value={partyVotes[p.id] ?? ''}
                onChange={(v) => updatePartyVotes({ [p.id]: v })}
              />
            ))}
          </div>
        )}

        <div className="card totals-card">
          <div className="tally-row derived">
            <span className="tally-label">Total valid votes</span>
            <span className="tally-total">{totalValidVotes}</span>
          </div>
          <div className="tally-row">
            <span className="tally-label">Invalid votes</span>
            <input
              type="number" inputMode="numeric" min="0"
              value={draft.totalInvalidVotes}
              onChange={(e) => updateDraft({ totalInvalidVotes: e.target.value })}
            />
          </div>
          <div className={`tally-row derived ${errors.totalVotes ? 'error' : ''}`}>
            <span className="tally-label">Total votes cast</span>
            <span className="tally-total">{totalVotes ?? '—'}</span>
          </div>
        </div>
        {errors.totalVotes && <p className="error-text" style={{ marginTop: 8 }}>{errors.totalVotes}</p>}
      </div>
      <ActionBar onBack={goBack} onNext={handleNext} nextDisabled={!baseFieldsFilled || Object.keys(errors).length > 0} />
    </>
  );
}
