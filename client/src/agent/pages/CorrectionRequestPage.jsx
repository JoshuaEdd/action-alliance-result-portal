import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import AgentHeader from '../components/AgentHeader';
import { sanitizeVotes } from '../utils/results';

// SEC-4 correction request page. This is NOT an "edit result" screen — the
// original submission stays untouched and read-only. The agent may only
// propose corrected figures, explain why, and submit them for admin review.

const fmt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

function ReadOnlyLedger({ title, rows }) {
  return (
    <div className="card">
      <div className="tally-row" style={{ fontWeight: 700 }}>
        <span>{title}</span>
        <span className="status-pill pending" style={{ textTransform: 'uppercase' }}>Submitted</span>
      </div>
      {rows.map(([label, value]) => (
        <div key={label} className="tally-row">
          <span className="tally-label">{label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function PartyRow({ name, abbreviation, original, proposed, onChange, hero = false }) {
  return (
    <div className={`party-card ${hero ? 'party-hero' : ''}`} style={{ padding: '10px 12px' }}>
      <div className="party-card-head">
        <span className={`party-abbr ${hero ? 'party-abbr-hero' : ''}`}>{abbreviation}</span>
        <span className="party-name">{name}</span>
      </div>
      {onChange ? (
        <div className="party-entry">
          <input
            type="text" inputMode="numeric" pattern="[0-9]*"
            aria-label={`Proposed ${name} votes`}
            value={proposed ?? '0'}
            onChange={(e) => onChange(sanitizeVotes(e.target.value))}
          />
        </div>
      ) : (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{original ?? '0'}</span>
      )}
    </div>
  );
}

export default function CorrectionRequestPage() {
  const { referenceNumber } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [submission, setSubmission] = useState(null);
  const [parties, setParties] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [registered, setRegistered] = useState('');
  const [accredited, setAccredited] = useState('');
  const [invalid, setInvalid] = useState('');
  const [proposal, setProposal] = useState({});
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState(null);
  const [evidenceUrl, setEvidenceUrl] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [created, setCreated] = useState(null);

  const [requestLocation, setRequestLocation] = useState(null);

  useEffect(() => {
    api
      .getMySubmission(token, referenceNumber)
      .then((d) => {
        setSubmission(d);
        // Seed the proposal with the ORIGINAL values so the agent only edits
        // what was wrong — but they are stored as a proposal, never applied.
        setRegistered(String(d.totals.registered));
        setAccredited(String(d.totals.accredited));
        setInvalid(String(d.totals.invalid));
        setProposal(Object.fromEntries(d.partyVotes.map((p) => [p.party_id, String(p.votes)])));
      })
      .catch((err) => setLoadError(err.message));
    api.getParties(token).then(setParties).catch(() => {});
  }, [token, referenceNumber]);

  // Optional correction-request location — purely audit metadata, captured
  // once when the page opens; if the user denies, it simply isn't included.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setRequestLocation({
          requestLat: pos.coords.latitude,
          requestLng: pos.coords.longitude,
        }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, []);

  // Commit/revoke the object URL for the optional evidence photo.
  useEffect(() => {
    if (!evidence) {
      setEvidenceUrl(null);
      return;
    }
    const url = URL.createObjectURL(evidence);
    setEvidenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [evidence]);

  const latestCorrection = useMemo(
    () => (submission && submission.corrections.length ? submission.corrections[0] : null),
    [submission]
  );

  const pendingCorrection = latestCorrection && latestCorrection.status === 'pending';
  const canRequest =
    submission &&
    !submission.supersededBy &&
    !pendingCorrection &&
    latestCorrection?.status !== 'approved';

  const originalPartyVotes = (snapshot) => {
    const raw = snapshot || {};
    return Object.entries(raw).map(([partyId, votes]) => [partyId, String(votes)]);
  };

  const partyName = (id) => {
    const p = (parties.find((x) => x.id === id) || submission?.partyVotes?.find((x) => x.party_id === id));
    return p ? `${p.abbreviation} (${p.name})` : id.slice(0, 8);
  };

  const derived = (reg, acc, inv, votesMap) => {
    const valid = Object.values(votesMap || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    const total = valid + (Number(inv) || 0);
    return {
      valid,
      total,
      errors:
        Number(acc) > Number(reg)
          ? ['Accredited voters cannot exceed registered voters']
          : total > Number(acc)
            ? ['Total votes (valid + invalid) cannot exceed accredited voters']
            : [],
    };
  };

  if (loadError) {
    return (
      <>
        <AgentHeader />
        <div className="step-content">
          <h2>Result not found</h2>
          <p className="error-text">{loadError}</p>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => navigate('/submit')}>
            Back
          </button>
        </div>
      </>
    );
  }

  if (!submission) {
    return (
      <>
        <AgentHeader />
        <div className="step-content"><p>Loading your submitted result…</p></div>
      </>
    );
  }

  // ── Status-only screens: a request is pending / was decided ──────────
  if (pendingCorrection) {
    const c = latestCorrection;
    return (
      <ResultStatusShell referenceNumber={submission.referenceNumber} navigate={navigate}>
        <div className={`status-pill correction_pending`}>Pending Admin Review</div>
        <h2>Correction Status: PENDING REVIEW</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
          Your correction request was submitted {fmt(c.created_at)}. An administrator will compare it against
          your original result sheet before it can affect the official result.
        </p>
        <ProposalComparison original={c} proposed={c} partyName={partyName} originalPartyVotes={originalPartyVotes} />
        <div className="card">
          <div className="tally-row"><span className="tally-label">Correction Reason</span></div>
          <p style={{ margin: '6px 0 0', fontSize: 14 }}>{c.reason}</p>
        </div>
      </ResultStatusShell>
    );
  }

  if (latestCorrection?.status === 'approved' || submission.supersededBy) {
    const c = latestCorrection;
    return (
      <ResultStatusShell referenceNumber={submission.referenceNumber} navigate={navigate}>
        <div className="status-pill submitted">Approved</div>
        <h2>Correction Status: APPROVED</h2>
        {c && (
          <>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
              Approved by {c.decided_by_name || 'an administrator'} on {fmt(c.decided_at)}.
              The corrected figures are now the official result for your polling unit; your original submission
              remains preserved in the audit history.
            </p>
            <ProposalComparison original={c} proposed={c} partyName={partyName} originalPartyVotes={originalPartyVotes} />
          </>
        )}
      </ResultStatusShell>
    );
  }

  if (latestCorrection?.status === 'rejected') {
    const c = latestCorrection;
    return (
      <ResultStatusShell referenceNumber={submission.referenceNumber} navigate={navigate}>
        <div className="status-pill flagged">Rejected</div>
        <h2>Correction Status: REJECTED</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
          The original result remains unchanged. Reason: {c.rejection_reason || 'No reason given.'}
        </p>
        <div className="card">
          <div className="tally-row"><span className="tally-label">Original result (unchanged)</span></div>
          <div className="ledger">
            {[
              ['Registered voters', submission.totals.registered],
              ['Accredited voters', submission.totals.accredited],
              ['Valid votes', submission.totals.valid],
              ['Invalid votes', submission.totals.invalid],
              ['Total votes', submission.totals.total],
            ].map(([label, value]) => (
              <div key={label} className="ledger-row">
                <span className="ledger-label">{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 20 }} onClick={() => { setCreated(null); setSubmitError(null); setReason(''); }}>
          Request a new correction
        </button>
      </ResultStatusShell>
    );
  }

  // ── Editor: propose a corrected result ───────────────────────────────
  const totals = (reg, acc, inv, map) => derived(reg, acc, inv, map);
  const d = totals(registered, accredited, invalid, proposal);
  const noChange =
    String(registered) === String(submission.totals.registered) &&
    String(accredited) === String(submission.totals.accredited) &&
    String(invalid) === String(submission.totals.invalid) &&
    submission.partyVotes.every((p) => String(proposal[p.party_id] ?? '0') === String(p.votes));

  const submit = async () => {
    setSubmitError(null);
    if (reason.trim().length < 20) {
      setSubmitError('Please explain what went wrong (at least 20 characters) — for example "Accidentally entered 250 instead of 25 for Candidate B. The result sheet shows 25."');
      return;
    }
    if (noChange) {
      setSubmitError('You have not changed any figure — enter the corrected values you believe the result sheet shows.');
      return;
    }
    setSubmitting(true);
    try {
      const votesPayload = Object.entries(proposal).map(([partyId, votes]) => ({
        partyId,
        votes: Number(votes) || 0,
      }));
      const form = new FormData();
      form.append('totalRegisteredVoters', registered);
      form.append('totalAccreditedVoters', accredited);
      form.append('totalInvalidVotes', invalid);
      form.append('partyVotes', JSON.stringify(votesPayload));
      form.append('reason', reason.trim());
      if (requestLocation?.requestLat != null) form.append('requestLat', String(requestLocation.requestLat));
      if (requestLocation?.requestLng != null) form.append('requestLng', String(requestLocation.requestLng));
      if (evidence) form.append('evidencePhoto', evidence, 'correction-evidence.jpg');
      const result = await api.requestCorrection(token, submission.id, form);
      setCreated(result);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <ResultStatusShell referenceNumber={submission.referenceNumber} navigate={navigate}>
        <div className="status-pill correction_pending">Pending Admin Review</div>
        <h2>Correction request submitted</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
          Your submitted result stays exactly as it was — {created.message}
        </p>
      </ResultStatusShell>
    );
  }

  // Unified party list for the editor — prefer the canonical registry, but
  // fall back to the parties actually recorded on this submission so the
  // proposed-vote inputs always render even if the registry fetch fails.
  const partiesForEdit = useMemo(() => {
    if (!submission) return [];
    if (parties.length) return parties;
    return submission.partyVotes.map((p) => ({
      id: p.party_id,
      name: p.name,
      abbreviation: p.abbreviation,
      is_priority: false,
    }));
  }, [parties, submission]);

  const priorityParty = partiesForEdit.find((p) => p.is_priority);
  const otherParties = partiesForEdit.filter((p) => !p.is_priority);

  return (
    <>
      <AgentHeader />
      <div className="step-content">
        <div className="admin-sticky-header" style={{ padding: '18px 0' }}>
          <div className="page-heading">
            <div className="page-kicker">Result Correction — never an edit</div>
            <h2 style={{ margin: 0 }}>Request Correction</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--ink-soft)', fontSize: 13 }}>
              {submission.pollingUnit.name} — PU {submission.pollingUnit.number}
              <br />
              <span className="reference-number" style={{ fontSize: 13 }}>{submission.referenceNumber}</span>
              {' · submitted '}{fmt(submission.createdAt)}
            </p>
          </div>
        </div>

        <div className="notice" style={{ marginBottom: 16 }}>
          <strong>Your submitted result is official and cannot be edited.</strong>{' '}
          Enter the figures you believe are correct below; an administrator will review your request and the
          original evidence before any change becomes official.
        </div>

        <ReadOnlyLedger
          title="Original Result"
          rows={[
            ['Registered voters', submission.totals.registered],
            ['Accredited voters', submission.totals.accredited],
            ['Valid votes', submission.totals.valid],
            ['Invalid votes', submission.totals.invalid],
            ['Total votes', submission.totals.total],
          ]}
        />

        <h3 style={{ fontSize: 14, marginTop: 24 }}>Proposed Correction</h3>
        <div className="tally-card-group">
          <div className="card">
            <div className="tally-row">
              <span className="tally-label">Registered voters</span>
              <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label="Proposed registered voters" value={registered} onChange={(e) => setRegistered(sanitizeVotes(e.target.value))} />
            </div>
            <div className="tally-row">
              <span className="tally-label">Accredited voters</span>
              <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label="Proposed accredited voters" value={accredited} onChange={(e) => setAccredited(sanitizeVotes(e.target.value))} />
            </div>
            <div className="tally-row">
              <span className="tally-label">Invalid votes</span>
              <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label="Proposed invalid votes" value={invalid} onChange={(e) => setInvalid(sanitizeVotes(e.target.value))} />
            </div>
          </div>
          <div className="card totals-card">
            <div className="tally-row derived"><span className="tally-label">Total valid votes</span><span className="tally-total">{d.valid}</span></div>
            <div className={`tally-row derived ${d.errors.length ? 'error' : ''}`}><span className="tally-label">Total votes cast</span><span className="tally-total">{d.total}</span></div>
          </div>
        </div>

        {d.errors.map((e) => <p key={e} className="error-text">{e}</p>)}

        <h3 style={{ fontSize: 14, marginTop: 24 }}>Party votes — Proposed Correction</h3>
        <p className="step-hint">Only change the figures you believe are wrong on the submitted result.</p>
        {priorityParty && (
          <PartyRow hero name={priorityParty.name} abbreviation={priorityParty.abbreviation} proposed={proposal[priorityParty.id] ?? '0'} onChange={(v) => setProposal((p) => ({ ...p, [priorityParty.id]: v }))} />
        )}
        {otherParties.map((p) => (
          <PartyRow key={p.id} name={p.name} abbreviation={p.abbreviation} proposed={proposal[p.id] ?? '0'} onChange={(v) => setProposal((prev) => ({ ...prev, [p.id]: v }))} />
        ))}

        <h3 style={{ fontSize: 14, marginTop: 24 }}>Correction Reason</h3>
        <p className="step-hint">Why are you requesting this correction? Explain the mistake clearly.</p>
        <textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Accidentally entered 250 instead of 25 for Candidate B. The result sheet shows 25."
          aria-label="Correction reason"
          style={{ width: '100%', border: '1.5px solid var(--line)', borderRadius: 12, padding: 12, fontFamily: 'inherit' }}
        />

        <h3 style={{ fontSize: 14, marginTop: 24 }}>Supporting evidence (optional)</h3>
        <p className="step-hint">A clearer photo of the result sheet helps the administrator verify your request. The original photos stay attached to your original submission.</p>
        {evidenceUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <img src={evidenceUrl} alt="Correction evidence preview" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 12 }} />
            <button className="btn btn-secondary" style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }} onClick={() => setEvidence(null)}>Remove</button>
          </div>
        ) : (
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setEvidence(e.target.files?.[0] || null)}
            aria-label="Add supporting evidence"
            style={{ display: 'block', marginBottom: 8 }}
          />
        )}

        {submitError && <p className="error-text">{submitError}</p>}

        <div className="action-bar" style={{ position: 'static', marginTop: 24 }}>
          <button className="btn btn-secondary" disabled={submitting} onClick={() => navigate('/submit')}>Back</button>
          <button className="btn btn-primary" disabled={submitting} onClick={submit}>
            {submitting ? 'Submitting…' : 'Submit Correction Request'}
          </button>
        </div>
      </div>
    </>
  );
}

function ResultStatusShell({ referenceNumber, navigate, children }) {
  return (
    <>
      <AgentHeader />
      <div className="step-content">
        <div className="reference-number" style={{ fontSize: 13, marginBottom: 8 }}>Ref: {referenceNumber}</div>
        {children}
        <button className="btn btn-secondary" style={{ width: '100%', marginTop: 28 }} onClick={() => navigate('/submit')}>
          Done
        </button>
      </div>
    </>
  );
}

// Side-by-side view of the original snapshot vs the proposed correction.
function ProposalComparison({ original, proposed, partyName, originalPartyVotes }) {
  const rows = [
    ['Registered voters', original.original_registered, proposed.proposed_registered],
    ['Accredited voters', original.original_accredited, proposed.proposed_accredited],
    ['Invalid votes', original.original_invalid, proposed.proposed_invalid],
    ...mergePartyRows(original.original_party_votes, proposed.proposed_party_votes, partyName, originalPartyVotes),
  ];
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="tally-row" style={{ fontWeight: 700, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
        <span />
        <span style={{ textAlign: 'right' }}>Original</span>
        <span style={{ textAlign: 'right' }}>Proposed</span>
      </div>
      {rows.map(([label, o, p]) => (
        <div key={label} className="tally-row">
          <span className="tally-label">{label}</span>
          <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: Number(o) !== Number(p) ? 'var(--error-red)' : undefined, textDecoration: Number(o) !== Number(p) ? 'line-through' : undefined }}>{o}</span>
          <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: Number(o) !== Number(p) ? 700 : 400 }}>{p}</span>
        </div>
      ))}
    </div>
  );
}

function mergePartyRows(originalSnapshot, proposedSnapshot, partyName, originalPartyVotes) {
  const keys = new Set([...Object.keys(originalSnapshot || {}), ...Object.keys(proposedSnapshot || {})]);
  return [...keys].map((id) => {
    const o = originalSnapshot[id] ?? 0;
    const p = proposedSnapshot[id] ?? 0;
    const name = partyName(id);
    return [name, o, p];
  });
}