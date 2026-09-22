// Pure helpers shared by the correction workflow (agent request + admin
// decision). Kept free of I/O so they can be unit-tested without a database.

// Normalizes the flexible party-vote shapes used across the codebase (an
// array of { partyId, votes } entries from validation, or an object map as
// stored in JSONB) into a single { [partyId]: Number } map.
export function votesToMap(partyVotes) {
  if (!partyVotes) return {};
  if (Array.isArray(partyVotes)) {
    const out = {};
    for (const { partyId, votes } of partyVotes) out[partyId] = Number(votes);
    return out;
  }
  const out = {};
  for (const [partyId, votes] of Object.entries(partyVotes)) out[partyId] = Number(votes);
  return out;
}

// A result snapshot is identified by its three head figures + per-party votes.
export function normalizedResult(result) {
  return {
    totalRegisteredVoters: Number(result.totalRegisteredVoters),
    totalAccreditedVoters: Number(result.totalAccreditedVoters),
    totalInvalidVotes: Number(result.totalInvalidVotes),
    partyVotes: votesToMap(result.partyVotes),
  };
}

// True when any entered figure differs between the original and proposed
// results — guards against "corrections" that change nothing.
export function resultsDiffer(original, proposed) {
  const o = normalizedResult(original);
  const p = normalizedResult(proposed);
  if (o.totalRegisteredVoters !== p.totalRegisteredVoters) return true;
  if (o.totalAccreditedVoters !== p.totalAccreditedVoters) return true;
  if (o.totalInvalidVotes !== p.totalInvalidVotes) return true;
  const ids = new Set([...Object.keys(o.partyVotes), ...Object.keys(p.partyVotes)]);
  for (const id of ids) {
    if ((o.partyVotes[id] || 0) !== (p.partyVotes[id] || 0)) return true;
  }
  return false;
}

// SEC-4 state machine: a decision only ever moves a request from 'pending' to
// 'approved' or 'rejected' — never approved→approved, approved→rejected, etc.
// A fresh request after a rejection is a NEW row, not a transition.
export function canTransitionCorrectionStatus(from, to) {
  return from === 'pending' && (to === 'approved' || to === 'rejected');
}