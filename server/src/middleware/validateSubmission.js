import { z } from 'zod';

const nigerianPhone = /^(\+234|0)[789][01]\d{8}$/;

const partyVoteEntry = z.object({
  partyId: z.string().uuid(),
  votes: z.coerce.number().int().min(0),
});

// partyVotes arrives as a JSON string (multipart form fields can't nest
// arrays), so it's parsed here before the rest of the shape is checked.
const partyVotesField = z.string().transform((val, ctx) => {
  let parsed;
  try {
    parsed = JSON.parse(val);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'partyVotes must be valid JSON' });
    return z.NEVER;
  }
  const result = z.array(partyVoteEntry).min(1, 'At least one party\'s votes are required').safeParse(parsed);
  if (!result.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid partyVotes entries' });
    return z.NEVER;
  }
  const ids = result.data.map((p) => p.partyId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate party in partyVotes' });
    return z.NEVER;
  }
  return result.data;
});

export const submissionSchema = z
  .object({
    pollingUnitId: z.string().uuid(),
    totalRegisteredVoters: z.coerce.number().int().min(0),
    totalAccreditedVoters: z.coerce.number().int().min(0),
    totalInvalidVotes: z.coerce.number().int().min(0),
    partyVotes: partyVotesField,
    submittingAgentName: z.string().min(2),
    submittingAgentPhone: z.string().regex(nigerianPhone, 'Invalid Nigerian phone number'),
    captureLat: z.coerce.number(),
    captureLng: z.coerce.number(),
    capturedAt: z.string().datetime(),
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
