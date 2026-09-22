import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useSubmission } from '../../context/SubmissionContext';
import { api } from '../../../api/client';
import { sanitizeVotes } from '../../utils/results';
import ActionBar from '../ActionBar';

// One tappable card per party. Every card has both a digits-only type-in
// input (figures go in exactly as printed on the result sheet) and +/−
// steppers for one-handed field entry. Letters, symbols, decimals and minus
// signs are stripped at keystroke — a result sheet only contains digits.
// AA (priority party) gets the brand-gradient hero card so its own result is
// never buried under the other ~20 parties.
function PartyCard({ name, abbreviation, value, onChange, hero = false }) {
  const bump = (delta) => {
    const current = Number(value) || 0;
    const next = Math.max(0, current + delta);
    // Still commit a real string so a party left at 0 counts as entered.
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
          type="text" inputMode="numeric" pattern="[0-9]*" minLength={0}
          placeholder="0"
          value={value ?? '0'}
          onChange={(e) => onChange(sanitizeVotes(e.target.value))}
          aria-label={`${name} votes`}
        />
        <button type="button" className="stepper-btn stepper-btn-add" onClick={() => bump(1)} aria-label={`Increase ${abbreviation}`}>
          +
        </button>
      </div>
    </div>
  );
}

function TallyInput({ value, onChange, ariaLabel }) {
  return (
    <input
      type="text" inputMode="numeric" pattern="[0-9]*" minLength={0}
      value={value ?? '0'}
      onChange={(e) => onChange(sanitizeVotes(e.target.value))}
      aria-label={ariaLabel}
    />
  );
}

export default function VoteCountsStep() {
  const { token } = useAuth();
  const { draft, updateDraft, partyVotes, updatePartyVotes, seedPartyVotes, goNext, goBack } = useSubmission();
  const [parties, setParties] = useState([]);
  const [showAllParties, setShowAllParties] = useState(false);
  const [attemptedContinue, setAttemptedContinue] = useState(false);

  useEffect(() => {
    api.getParties(token).then((list) => {
      setParties(list);
      // Every party's figure defaults to 0 — nothing is left blank on the
      // preview, and totals add up with zeroes for unclaimed parties.
      seedPartyVotes(list.map((p) => p.id));
    }).catch(() => {});
  }, [token, seedPartyVotes]);

  const priorityParty = parties.find((p) => p.is_priority);
  const otherParties = parties.filter((p) => !p.is_priority);

  const n = (key) => {
    const v = Number(draft[key]);
    return Number.isFinite(v) ? v : 0;
  };

  const totalValidVotes = useMemo(
    () => parties.reduce((sum, p) => sum + (Number(partyVotes[p.id]) || 0), 0),
    [parties, partyVotes]
  );
  const totalInvalidVotes = n('totalInvalidVotes');
  const totalVotes = totalValidVotes + totalInvalidVotes;

  // FR-2.4 — inline validation errors as the agent types, not only at preview
  const errors = useMemo(() => {
    const e = {};
    const registered = n('totalRegisteredVoters');
    const accredited = n('totalAccreditedVoters');

    if (accredited > registered) {
      e.totalAccreditedVoters = 'Accredited voters cannot exceed registered voters';
    }
    if (totalVotes > accredited) {
      e.totalVotes = 'Total votes (valid + invalid) cannot exceed accredited voters';
    }
    return e;
  }, [draft, totalVotes]);

  const allPartiesFilled = parties.length > 0 && parties.every((p) => partyVotes[p.id] !== undefined && partyVotes[p.id] !== '');
  const baseFieldsFilled = true; // totals default to 0, always present

  const handleNext = () => {
    if (!allPartiesFilled) {
      setAttemptedContinue(true);
      setShowAllParties(true);
      return;
    }
    if (Object.keys(errors).length > 0) return;
    goNext();
  };

  return (
    <>
      <div className="step-content">
        <h2>Record the vote counts</h2>
        <p className="step-hint">
          Enter figures exactly as they appear on the polling unit result sheet.
        </p>

        <div className="tally-card-group">
          <div className="card">
            <div className="tally-row">
              <span className="tally-label">Registered voters</span>
              <TallyInput
                value={draft.totalRegisteredVoters}
                onChange={(v) => updateDraft({ totalRegisteredVoters: v })}
                ariaLabel="Registered voters"
              />
            </div>
            <div className={`tally-row ${errors.totalAccreditedVoters ? 'error' : ''}`}>
              <span className="tally-label">Accredited voters</span>
              <TallyInput
                value={draft.totalAccreditedVoters}
                onChange={(v) => updateDraft({ totalAccreditedVoters: v })}
                ariaLabel="Accredited voters"
              />
            </div>
            {errors.totalAccreditedVoters && <p className="error-text" style={{ padding: '0 16px 10px' }}>{errors.totalAccreditedVoters}</p>}
          </div>

          <div className="card totals-card">
            <div className="tally-row derived">
              <span className="tally-label">Total valid votes</span>
              <span className="tally-total">{totalValidVotes}</span>
            </div>
            <div className="tally-row">
              <span className="tally-label">Invalid votes</span>
              <TallyInput
                value={draft.totalInvalidVotes}
                onChange={(v) => updateDraft({ totalInvalidVotes: v })}
                ariaLabel="Invalid votes"
              />
            </div>
            <div className={`tally-row derived ${errors.totalVotes ? 'error' : ''}`}>
              <span className="tally-label">Total votes cast</span>
              <span className="tally-total">{totalVotes}</span>
            </div>
          </div>
        </div>
        {errors.totalVotes && <p className="error-text" style={{ marginTop: 8 }}>{errors.totalVotes}</p>}

        {/* Action Alliance is always shown first and prominently — this is
            an AA-operated portal, so its own result is never buried under
            the other 20 parties on the ballot. */}
        {priorityParty && (
          <PartyCard
            hero
            name={priorityParty.name}
            abbreviation={priorityParty.abbreviation}
            value={partyVotes[priorityParty.id] ?? '0'}
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

        {showAllParties && (
          <div className="party-feed" style={{ marginBottom: 16 }}>
            {otherParties.map((p) => (
              <PartyCard
                key={p.id}
                name={p.name}
                abbreviation={p.abbreviation}
                value={partyVotes[p.id] ?? '0'}
                onChange={(v) => updatePartyVotes({ [p.id]: v })}
              />
            ))}
          </div>
        )}

        {attemptedContinue && !allPartiesFilled && (
          <p className="error-text" style={{ marginBottom: 12 }}>
            Every party on the result sheet needs a vote count (enter 0 where a party has none).
          </p>
        )}
      </div>
      <ActionBar onBack={goBack} onNext={handleNext} nextDisabled={!baseFieldsFilled || Object.keys(errors).length > 0} />
    </>
  );
}