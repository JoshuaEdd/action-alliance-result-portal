import { z } from 'zod';

const nigerianPhone = /^(\+234|0)[789][01]\d{8}$/;

// Votes must read as whole, non-negative numbers. Letters and symbols are
// rejected with an explicit message so the agent knows exactly why a draft
// bounced instead of back-end default jargon (`required_error` catches an
// empty entry, `invalid_type_error` catches non-numeric input, `int` catches
// decimals, and `min` catches negatives).
const votesField = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.coerce
    .number({
      invalid_type_error: 'Numbers only — letters and symbols are not allowed',
      required_error: 'Numbers only — letters and symbols are not allowed',
    })
    .int('Enter a whole number (no decimals)')
    .min(0, 'Cannot be less than zero')
);

const partyVoteEntry = z.object({
  partyId: z.string().uuid(),
  votes: votesField,
});

// A party-votes payload is an array of { partyId, votes }. Submissions send it
// as a JSON string (multipart form fields can't nest arrays); correction
// requests may send either the JSON string or a native array in a JSON body —
// both are parsed down to the same validated array.
function parsePartyVotesPayload(val, ctx) {
  let parsed;
  if (typeof val === 'string') {
    try {
      parsed = JSON.parse(val);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'partyVotes must be valid JSON' });
      return z.NEVER;
    }
  } else {
    parsed = val;
  }
  const result = z.array(partyVoteEntry).min(1, 'At least one party\'s votes are required').safeParse(parsed);
  if (!result.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Votes must be whole numbers 0 or greater — letters and symbols are not allowed',
    });
    return z.NEVER;
  }
  const ids = result.data.map((p) => p.partyId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate party in partyVotes' });
    return z.NEVER;
  }
  return result.data;
}

// Submitted results carry partyVotes as a JSON string (multipart).
const partyVotesField = z.string().transform((val, ctx) => parsePartyVotesPayload(val, ctx));

// Correction requests carry partyVotes as an array (JSON body) or a JSON string.
// z.unknown keeps the union failure from swallowing the friendly per-vote
// messages below — parsePartyVotesPayload issues them itself either way.
const flexiblePartyVotesField = z.unknown().transform((val, ctx) => parsePartyVotesPayload(val, ctx));

// photoTimestamps arrives as a JSON string mapping photo field name → ISO
// datetime of the actual shutter press. Optional (older clients don't send
// it); unknown keys and unparseable values are dropped, never rejected —
// this is audit enrichment, not a gate.
const photoTimestampsField = z.string().optional().transform((val, ctx) => {
  if (!val) return {};
  let parsed;
  try {
    parsed = JSON.parse(val);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'photoTimestamps must be valid JSON' });
    return z.NEVER;
  }
  const out = {};
  for (const [key, iso] of Object.entries(parsed)) {
    if (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))) {
      out[key] = new Date(iso);
    }
  }
  return out;
});

export const submissionSchema = z
  .object({
    pollingUnitId: z.string().uuid(),
    totalRegisteredVoters: votesField,
    totalAccreditedVoters: votesField,
    totalInvalidVotes: votesField,
    partyVotes: partyVotesField,
    submittingAgentName: z.string().min(2),
    submittingAgentPhone: z.string().regex(nigerianPhone, 'Invalid Nigerian phone number'),
    captureLat: z.coerce.number(),
    captureLng: z.coerce.number(),
    capturedAt: z.string().datetime(),
    photoTimestamps: photoTimestampsField,
  })
  // total valid votes and total votes are derived here, not separately
  // agent-entered — a real result sheet's "total valid votes" is just the
  // sum of every party's score, so there's nothing to reconcile against.
  .transform((d) => ({
    ...d,
    totalValidVotes: d.partyVotes.reduce((sum, p) => sum + p.votes, 0),
    totalVotes: d.partyVotes.reduce((sum, p) => sum + p.votes, 0) + d.totalInvalidVotes,
  }))
  // SEC-2: server-side arithmetic integrity, independent of client validation
  .refine((d) => d.totalAccreditedVoters <= d.totalRegisteredVoters, {
    message: 'accredited voters cannot exceed registered voters',
    path: ['totalAccreditedVoters'],
  })
  .refine((d) => d.totalVotes <= d.totalAccreditedVoters, {
    message: 'total votes cannot exceed accredited voters',
    path: ['totalVotes'],
  });

export function validateSubmission(req, res, next) {
  const result = submissionSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({ error: 'Validation failed', details: result.error.flatten() });
  }
  req.validated = result.data;
  next();
}

// ─────────────────────────────────────────────────────────────────────
// SEC-4 correction proposals are validated with the SAME numeric rules as
// an original submission — the workflow must never become a way to bypass
// result validation. A proposal is a full result: registered/accredited/
// invalid figures plus per-party votes (valid + total stay derived). The
// reason must be a real, human explanation, not a one-liner.
// ─────────────────────────────────────────────────────────────────────
export const CORRECTION_REASON_MIN_LENGTH = 20;
export const CORRECTION_REASON_MAX_LENGTH = 1000;

export const correctionProposalSchema = z
  .object({
    totalRegisteredVoters: votesField,
    totalAccreditedVoters: votesField,
    totalInvalidVotes: votesField,
    partyVotes: flexiblePartyVotesField,
    reason: z
      .string()
      .trim()
      .min(
        CORRECTION_REASON_MIN_LENGTH,
        `Explain what went wrong (at least ${CORRECTION_REASON_MIN_LENGTH} characters)`
      )
      .max(CORRECTION_REASON_MAX_LENGTH, 'Correction reason is too long'),
    // The agent's location at request time — optional, kept separate from the
    // original submission's capture coordinates, which are never overwritten.
    requestLat: z.coerce.number().optional(),
    requestLng: z.coerce.number().optional(),
  })
  // total valid votes and total votes are derived exactly as on submission.
  .transform((d) => ({
    ...d,
    totalValidVotes: d.partyVotes.reduce((sum, p) => sum + p.votes, 0),
    totalVotes: d.partyVotes.reduce((sum, p) => sum + p.votes, 0) + d.totalInvalidVotes,
  }))
  .refine((d) => d.totalAccreditedVoters <= d.totalRegisteredVoters, {
    message: 'accredited voters cannot exceed registered voters',
    path: ['totalAccreditedVoters'],
  })
  .refine((d) => d.totalVotes <= d.totalAccreditedVoters, {
    message: 'total votes cannot exceed accredited voters',
    path: ['totalVotes'],
  });

export function validateCorrectionProposal(req, res, next) {
  const result = correctionProposalSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({ error: 'Validation failed', details: result.error.flatten() });
  }
  req.correction = result.data;
  next();
}

// SEC-7: flag (not reject) submissions captured outside the PU's registered radius
export function isOutsideRadius(lat1, lng1, lat2, lng2, radiusMeters) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const distance = 2 * R * Math.asin(Math.sqrt(a));
  return distance > radiusMeters;
}
