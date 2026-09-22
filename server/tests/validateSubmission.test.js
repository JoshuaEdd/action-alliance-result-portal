import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  submissionSchema,
  correctionProposalSchema,
  isOutsideRadius,
} from '../src/middleware/validateSubmission.js';
import { canTransitionCorrectionStatus, resultsDiffer } from '../src/utils/corrections.js';

// Quick shape that passes every structural check except the field under test.
function baseBody(overrides = {}) {
  return {
    pollingUnitId: '00000000-0000-0000-0000-000000000001',
    totalRegisteredVoters: '100',
    totalAccreditedVoters: '80',
    totalInvalidVotes: '2',
    partyVotes: JSON.stringify([{ partyId: '00000000-0000-0000-0000-000000000002', votes: '78' }]),
    submittingAgentName: 'Ada Obi',
    submittingAgentPhone: '08012345678',
    captureLat: '5.49',
    captureLng: '7.02',
    capturedAt: new Date().toISOString(),
    photoTimestamps: JSON.stringify({ resultSheetPhoto: new Date().toISOString() }),
    ...overrides,
  };
}

test('accepts a clean submission with string digit fields', () => {
  const r = submissionSchema.safeParse(baseBody());
  assert.equal(r.success, true);
  assert.equal(r.data.totalValidVotes, 78);
  assert.equal(r.data.totalVotes, 80);
});

test('rejects letters and symbols in result fields with a clear message', () => {
  const r = submissionSchema.safeParse(baseBody({ totalRegisteredVoters: '12O' }));
  assert.equal(r.success, false);
  const details = JSON.stringify(r.error.flatten());
  assert.match(details, /Numbers only/);
});

test('rejects decimals and negatives in result fields', () => {
  assert.equal(submissionSchema.safeParse(baseBody({ totalAccreditedVoters: '1.5' })).success, false);
  assert.equal(submissionSchema.safeParse(baseBody({ totalInvalidVotes: '-3' })).success, false);
});

test('rejects non-digit party vote entries with a clear message', () => {
  const votes = JSON.stringify([{ partyId: '00000000-0000-0000-0000-000000000002', votes: '5x' }]);
  const r = submissionSchema.safeParse(baseBody({ partyVotes: votes }));
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error.flatten()), /whole numbers 0 or greater/);
});

test('empty numeric strings are rejected (they must default to 0 client-side)', () => {
  const r = submissionSchema.safeParse(baseBody({ totalInvalidVotes: '' }));
  assert.equal(r.success, false);
});

test('isOutsideRadius flags captures far from the registered point', () => {
  // ~0 meters apart at the same point
  assert.equal(isOutsideRadius(5.49, 7.02, 5.49, 7.02, 500), false);
  // ~1 arc-minute of latitude ≈ 1852m — clearly outside a 500m radius
  assert.equal(isOutsideRadius(5.49, 7.02, 5.49 + 0.0167, 7.02, 500), true);
  // well inside when squared away from the same latitude
  assert.equal(isOutsideRadius(5.49, 7.02, 5.492, 7.022, 500), false);
});

// ── SEC-4 correction proposals ────────────────────────────────────────
function correctionBody(overrides = {}) {
  return {
    totalRegisteredVoters: '100',
    totalAccreditedVoters: '80',
    totalInvalidVotes: '2',
    partyVotes: [{ partyId: '00000000-0000-0000-0000-000000000002', votes: 78 }],
    reason: 'Entered the wrong figures for party B on the result sheet.',
    ...overrides,
  };
}

test('accepts a correction proposal with partyVotes as a native array (JSON body)', () => {
  const r = correctionProposalSchema.safeParse(correctionBody());
  assert.equal(r.success, true);
  assert.equal(r.data.totalValidVotes, 78);
  assert.equal(r.data.totalVotes, 80);
});

test('accepts a correction proposal with partyVotes as a JSON string (multipart)', () => {
  const r = correctionProposalSchema.safeParse(
    correctionBody({ partyVotes: JSON.stringify([{ partyId: '00000000-0000-0000-0000-000000000002', votes: 78 }]) })
  );
  assert.equal(r.success, true);
  assert.equal(r.data.partyVotes[0].votes, 78);
});

test('rejects non-digit party vote entries in a correction proposal', () => {
  const r = correctionProposalSchema.safeParse(
    correctionBody({ partyVotes: [{ partyId: '00000000-0000-0000-0000-000000000002', votes: '5x' }] })
  );
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error.flatten()), /whole numbers 0 or greater/);
});

test('rejects a correction reason shorter than the minimum explanation length', () => {
  const r = correctionProposalSchema.safeParse(correctionBody({ reason: 'Typo.' }));
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error.flatten()), /at least 20 characters/);
});

test('rejects a correction proposal where accredited voters exceed registered', () => {
  const r = correctionProposalSchema.safeParse(correctionBody({ totalAccreditedVoters: '120' }));
  assert.equal(r.success, false);
});

test('accepts optional request coordinates and coerces decimal strings', () => {
  const r = correctionProposalSchema.safeParse(
    correctionBody({ requestLat: '5.4900001', requestLng: '7.0212' })
  );
  assert.equal(r.success, true);
  assert.equal(r.data.requestLat, 5.4900001);
});

// ── SEC-4 state machine + result comparison helpers ───────────────────
test('canTransitionCorrectionStatus only allows pending → approved|rejected', () => {
  assert.equal(canTransitionCorrectionStatus('pending', 'approved'), true);
  assert.equal(canTransitionCorrectionStatus('pending', 'rejected'), true);
  assert.equal(canTransitionCorrectionStatus('approved', 'rejected'), false);
  assert.equal(canTransitionCorrectionStatus('rejected', 'approved'), false);
  assert.equal(canTransitionCorrectionStatus('pending', 'pending'), false);
});

test('resultsDiffer flags any changed headline figure or party vote', () => {
  const original = {
    totalRegisteredVoters: 100,
    totalAccreditedVoters: 80,
    totalInvalidVotes: 2,
    partyVotes: [{ partyId: 'a', votes: 78 }],
  };
  const same = { ...original, partyVotes: [{ partyId: 'a', votes: '78' }] };
  assert.equal(resultsDiffer(original, same), false);
  assert.equal(resultsDiffer(original, { ...original, totalInvalidVotes: 3 }), true);
  assert.equal(resultsDiffer(original, { ...original, partyVotes: [{ partyId: 'a', votes: 79 }] }), true);
  // a party present in one but absent in the other counts as a change
  assert.equal(
    resultsDiffer(original, {
      ...original,
      partyVotes: [
        { partyId: 'a', votes: 78 },
        { partyId: 'b', votes: 1 },
      ],
    }),
    true
  );
});