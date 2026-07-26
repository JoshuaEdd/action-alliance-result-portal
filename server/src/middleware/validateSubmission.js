import { z } from 'zod';

const nigerianPhone = /^(\+234|0)[789][01]\d{8}$/;

export const submissionSchema = z
  .object({
    pollingUnitId: z.string().uuid(),
    totalRegisteredVoters: z.coerce.number().int().min(0),
    totalAccreditedVoters: z.coerce.number().int().min(0),
    totalValidVotes: z.coerce.number().int().min(0),
    totalInvalidVotes: z.coerce.number().int().min(0),
    totalVotes: z.coerce.number().int().min(0),
    submittingAgentName: z.string().min(2),
    submittingAgentPhone: z.string().regex(nigerianPhone, 'Invalid Nigerian phone number'),
    captureLat: z.coerce.number(),
    captureLng: z.coerce.number(),
    capturedAt: z.string().datetime(),
  })
  // SEC-2: server-side arithmetic integrity, independent of client validation
  .refine((d) => d.totalVotes === d.totalValidVotes + d.totalInvalidVotes, {
    message: 'total votes must equal valid + invalid votes',
    path: ['totalVotes'],
  })
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
