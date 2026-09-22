import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  correctionProposalSchema,
  CORRECTION_REASON_MIN_LENGTH,
} from '../src/middleware/validateSubmission.js';
import {
  votesToMap,
  normalizedResult,
  resultsDiffer,
  canTransitionCorrectionStatus,
} from '../src/utils/corrections.js';

const PARTY_A = '00000000-0000-0000-0000-000000000002';
const PARTY_B = '00000000-0000-0000-0000-000000000003';

// A proposed correction that satisfies every validation rule except the
// field under test at the call site.
function baseCorrection(overrides = {}) {
  return {
    totalRegisteredVoters: '100',
    totalAccreditedVoters: '80',
    totalInvalidVotes: '2',
    partyVotes: [
      { partyId: PARTY_A, votes: 78 },
      { partyId: PARTY_B, votes: 0 },
    ],
    reason: 'The result sheet clearly shows a transposed figure for the second party on the recorder.',
    ...overrides,
  };
}

test('accepts a clean correction proposal and derives valid + total votes', () => {
  const r = correctionProposalSchema.safeParse(baseCorrection());
  assert.equal(r.success, true);
  assert.equal(r.data.totalValidVotes, 78);
  assert.equal(r.data.totalVotes, 80);
});

test('accepts a correction proposal sent as a JSON-string partyVotes (multipart)', () => {
  const body = baseCorrection({ partyVotes: JSON.stringify([{ partyId: PARTY_A, votes: '78' }]) });
  const r = correctionProposalSchema.safeParse(body);
  assert.equal(r.success, true);
  assert.equal(r.data.partyVotes.length, 1);
});

test('rejects a proposal whose party votes sum past the accredited voters', () => {
  const r = correctionProposalSchema.safeParse(baseCorrection({ totalAccreditedVoters: '70' }));
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error.flatten()), /total votes cannot exceed accredited/);
});

test('rejects a proposal with accredited voters above registered voters', () => {
  const r = correctionProposalSchema.safeParse(baseCorrection({ totalAccreditedVoters: '120' }));
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error.flatten()), /accredited voters cannot exceed registered/);
});

test('still enforces the vote field rules (no letters, decimals or negatives)', () => {
  assert.equal(correctionProposalSchema.safeParse(baseCorrection({ totalInvalidVotes: '1x' })).success, false);
  assert.equal(correctionProposalSchema.safeParse(baseCorrection({ totalInvalidVotes: '-1' })).success, false);
  assert.equal(correctionProposalSchema.safeParse(baseCorrection({ totalRegisteredVoters: '10.5' })).success, false);
});

test('rejects a too-short or missing correction reason', () => {
  const tooShort = correctionProposalSchema.safeParse(baseCorrection({ reason: 'typo' }));
  assert.equal(tooShort.success, false);
  assert.match(JSON.stringify(tooShort.error.flatten()), new RegExp(`at least ${CORRECTION_REASON_MIN_LENGTH}`));
  assert.equal(correctionProposalSchema.safeParse(baseCorrection({ reason: '' })).success, false);
});

test('rejects duplicate parties and malformed partyVotes JSON', () => {
  const dup = baseCorrection({
    partyVotes: [
      { partyId: PARTY_A, votes: 5 },
      { partyId: PARTY_A, votes: 5 },
    ],
  });
  assert.equal(correctionProposalSchema.safeParse(dup).success, false);
  assert.equal(correctionProposalSchema.safeParse(baseCorrection({ partyVotes: '{nope' })).success, false);
});

test('votesToMap flattens array payloads and stored JSONB maps alike', () => {
  assert.deepEqual(votesToMap([{ partyId: PARTY_A, votes: '7' }, { partyId: PARTY_B, votes: 3 }]), {
    [PARTY_A]: 7,
    [PARTY_B]: 3,
  });
  assert.deepEqual(votesToMap({ [PARTY_A]: 7, [PARTY_B]: 0 }), { [PARTY_A]: 7, [PARTY_B]: 0 });
  assert.deepEqual(votesToMap(null), {});
});

test('resultsDiffer spots a change in any figure or party vote', () => {
  const original = { totalRegisteredVoters: 100, totalAccreditedVoters: 80, totalInvalidVotes: 2, partyVotes: [{ partyId: PARTY_A, votes: 78 }] };
  assert.equal(resultsDiffer(original, { ...original }), false);
  assert.equal(resultsDiffer(original, { ...original, totalInvalidVotes: 3 }), true);
  assert.equal(resultsDiffer(original, { ...original, partyVotes: [{ partyId: PARTY_A, votes: 25 }] }), true);
});

test('canTransitionCorrectionStatus only allows pending → approved/rejected', () => {
  assert.equal(canTransitionCorrectionStatus('pending', 'approved'), true);
  assert.equal(canTransitionCorrectionStatus('pending', 'rejected'), true);
  assert.equal(canTransitionCorrectionStatus('approved', 'rejected'), false);
  assert.equal(canTransitionCorrectionStatus('approved', 'approved'), false);
  assert.equal(canTransitionCorrectionStatus('rejected', 'approved'), false);
  assert.equal(canTransitionCorrectionStatus('rejected', 'rejected'), false);
});

test('normalizedResult coerces every figure to a number', () => {
  const n = normalizedResult({ totalRegisteredVoters: '100', totalAccreditedVoters: '80', totalInvalidVotes: '2', partyVotes: { [PARTY_A]: '78' } });
  assert.deepEqual(n, {
    totalRegisteredVoters: 100,
    totalAccreditedVoters: 80,
    totalInvalidVotes: 2,
    partyVotes: { [PARTY_A]: 78 },
  });
});