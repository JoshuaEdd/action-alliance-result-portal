import express from 'express';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  validateSubmission,
  validateCorrectionProposal,
  isOutsideRadius,
} from '../middleware/validateSubmission.js';
import { upload, scanFile } from '../middleware/upload.js';
import { requireAgentPortalActive } from '../middleware/portal.js';
import { reverseGeocodePlace } from '../utils/placeName.js';
import { resultsDiffer, votesToMap } from '../utils/corrections.js';

const router = express.Router();
const GPS_RADIUS = Number(process.env.GPS_FLAG_RADIUS_METERS || 500);

function generateReferenceNumber() {
  // Short, agent-readable, collision-resistant enough for a confirmation screen
  return `AA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

// FR-2.* — submit a polling-unit result. Multipart: fields + 3 required photos.
// The global agent-portal switch is enforced server-side here (423 when off).
router.post(
  '/',
  requireAuth,
  requireRole('agent'),
  requireAgentPortalActive,
  upload.fields([
    { name: 'agentTagPhoto', maxCount: 1 },
    { name: 'resultSheetPhoto', maxCount: 1 },
    { name: 'agentPassportPhoto', maxCount: 1 },
  ]),
  validateSubmission,
  async (req, res) => {
    const d = req.validated;

    // Agents may only submit for their own locked, assigned polling unit
    if (!req.user.locationLocked || d.pollingUnitId !== req.user.assignedPollingUnitId) {
      return res.status(403).json({ error: 'You may only submit a result for your assigned polling unit' });
    }

    const files = req.files || {};
    if (!files.agentTagPhoto || !files.resultSheetPhoto || !files.agentPassportPhoto) {
      return res.status(422).json({ error: 'All three photos (agent tag, result sheet, passport) are required' });
    }

    for (const key of Object.keys(files)) {
      const scan = await scanFile(files[key][0].buffer);
      if (!scan.clean) return res.status(422).json({ error: 'A file failed the security scan' });
    }

    const partyIds = d.partyVotes.map((p) => p.partyId);
    const { rows: knownParties } = await pool.query(
      `SELECT id FROM political_parties WHERE id = ANY($1::uuid[])`,
      [partyIds]
    );
    if (knownParties.length !== partyIds.length) {
      return res.status(422).json({ error: 'One or more parties in partyVotes were not recognized' });
    }

    // SEC-7 — flag, don't reject, if capture point is far from the PU's registered coordinates
    const { rows: puRows } = await pool.query(
      `SELECT registered_lat, registered_lng FROM polling_units WHERE id = $1`,
      [d.pollingUnitId]
    );
    const pu = puRows[0];
    const gpsFlagged =
      pu?.registered_lat != null &&
      isOutsideRadius(pu.registered_lat, pu.registered_lng, d.captureLat, d.captureLng, GPS_RADIUS);

    // Human-readable capture location for the admins' review screen. Fails
    // soft to NULL (no internet, geocoder down) — never blocks a submission.
    // Cached in-process, so a metre-off retry won't re-hit the network.
    const capturePlace = await reverseGeocodePlace(d.captureLat, d.captureLng);

    // The agent's registration record is the single source of truth for their
    // name and phone — never trust the payload (req: don't re-ask agents).
    const { rows: agentRows } = await pool.query(
      `SELECT full_name, phone_number FROM users WHERE id = $1 AND role = 'agent'`,
      [req.user.id]
    );
    const submittingAgentName = agentRows[0]?.full_name || d.submittingAgentName;
    const submittingAgentPhone = agentRows[0]?.phone_number || d.submittingAgentPhone;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const referenceNumber = generateReferenceNumber();
      const insertResult = await client.query(
        `INSERT INTO submissions (
           reference_number, polling_unit_id, agent_id,
           total_registered_voters, total_accredited_voters,
           total_valid_votes, total_invalid_votes, total_votes,
           submitting_agent_name, submitting_agent_phone,
           capture_lat, capture_lng, capture_place, captured_at, gps_flagged, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id, reference_number, status`,
        [
          referenceNumber,
          d.pollingUnitId,
          req.user.id,
          d.totalRegisteredVoters,
          d.totalAccreditedVoters,
          d.totalValidVotes,
          d.totalInvalidVotes,
          d.totalVotes,
          submittingAgentName,
          submittingAgentPhone,
          d.captureLat,
          d.captureLng,
          capturePlace,
          d.capturedAt,
          gpsFlagged,
          gpsFlagged ? 'flagged' : 'submitted',
        ]
      );
      const submission = insertResult.rows[0];

      const photoMap = {
        agentTagPhoto: 'agent_tag',
        resultSheetPhoto: 'result_sheet',
        agentPassportPhoto: 'agent_passport',
      };
      for (const [field, photoType] of Object.entries(photoMap)) {
        const file = files[field][0];
        // Per-photo shutter time from the client (falls back to the GPS-fix
        // time, then to server receive time). created_at stays as the
        // server-side receipt time — the two can differ by hours when a
        // submission was queued offline.
        // d.capturedAt arrives as a datetime STRING while a per-photo
        // timestamp is already a Date — coercing both to a real Date here
        // keeps the .toISOString() log below (and the column write) from
        // ever throwing a TypeError on a missing timestamp.
        const rawCapture = d.photoTimestamps?.[field] || d.capturedAt;
        const capturedAt =
          rawCapture instanceof Date
            ? rawCapture
            : typeof rawCapture === 'string' && !Number.isNaN(Date.parse(rawCapture))
              ? new Date(rawCapture)
              : new Date();
        console.log(
          `[submission] photo received ref=${referenceNumber} type=${photoType} ` +
          `captured_at=${capturedAt.toISOString()} received_at=${new Date().toISOString()} ` +
          `bytes=${file.size}`
        );
        await client.query(
          `INSERT INTO submission_photos (submission_id, photo_type, data, mime_type, size_bytes, captured_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [submission.id, photoType, file.buffer, file.mimetype, file.size, capturedAt]
        );
      }

      for (const p of d.partyVotes) {
        await client.query(
          `INSERT INTO submission_party_votes (submission_id, party_id, votes) VALUES ($1, $2, $3)`,
          [submission.id, p.partyId, p.votes]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({
        referenceNumber: submission.reference_number,
        status: submission.status,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      // SEC-5 — unique index violation means this PU already has an accepted submission
      if (err.code === '23505' && err.constraint === 'one_accepted_submission_per_pu') {
        return res.status(409).json({
          error: 'A result has already been submitted for this polling unit. This attempt has been flagged as a duplicate for administrator review.',
        });
      }
      console.error(`[submissions] POST / failed:`, err);
      // The DB cause (missing column, constraint, etc.) goes in the response
      // in dev so the failure is diagnosable at the client; production keeps
      // a clean generic message with the stack reserved for server logs.
      if (process.env.NODE_ENV !== 'production') {
        return res.status(500).json({
          error: 'Could not save submission, please retry',
          details: err.message,
        });
      }
      res.status(500).json({ error: 'Could not save submission, please retry' });
    } finally {
      client.release();
    }
  }
);

// FR-2.13 — agent's own submitted results, newest first, with enough context
// to find a specific result and request a correction (SEC-4). The latest
// correction status per result is folded in so the client can show whether a
// request is pending / was decided without a second round trip.
router.get('/mine', requireAuth, requireRole('agent'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.reference_number, s.status, s.created_at, s.capture_lat, s.capture_lng,
            s.total_registered_voters, s.total_accredited_voters,
            s.total_valid_votes, s.total_invalid_votes, s.total_votes,
            s.duplicate_of, s.superseded_by, s.corrected_by,
            pu.name AS pu_name, pu.pu_number, w.name AS ward_name, lg.name AS lga_name,
            (SELECT cr.status FROM correction_requests cr
              WHERE cr.submission_id = s.id ORDER BY cr.created_at DESC LIMIT 1)
              AS latest_correction_status
     FROM submissions s
     JOIN polling_units pu ON pu.id = s.polling_unit_id
     JOIN wards w ON w.id = pu.ward_id
     JOIN local_governments lg ON lg.id = w.local_government_id
     WHERE s.agent_id = $1
     ORDER BY s.created_at DESC`,
    [req.user.id]
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      referenceNumber: r.reference_number,
      status: r.status,
      createdAt: r.created_at,
      totals: {
        registered: r.total_registered_voters,
        accredited: r.total_accredited_voters,
        valid: r.total_valid_votes,
        invalid: r.total_invalid_votes,
        total: r.total_votes,
      },
      pollingUnit: { name: r.pu_name, number: r.pu_number },
      ward: r.ward_name,
      lga: r.lga_name,
      isDuplicate: !!r.duplicate_of,
      supersededBy: r.superseded_by,
      correctedBy: r.corrected_by,
      latestCorrectionStatus: r.latest_correction_status || null,
    }))
  );
});

// FR-2.13 — agent checks status of their own submission (extended: full
// result + correction history so the agent can review and correct it)
router.get('/mine/:referenceNumber', requireAuth, requireRole('agent'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.reference_number, s.status, s.created_at, s.polling_unit_id,
            s.total_registered_voters, s.total_accredited_voters,
            s.total_valid_votes, s.total_invalid_votes, s.total_votes,
            s.superseded_by, s.corrected_by,
            pu.name AS pu_name, pu.pu_number,
            w.name AS ward_name, lg.name AS lga_name
     FROM submissions s
     JOIN polling_units pu ON pu.id = s.polling_unit_id
     JOIN wards w ON w.id = pu.ward_id
     JOIN local_governments lg ON lg.id = w.local_government_id
     WHERE s.reference_number = $1 AND s.agent_id = $2`,
    [req.params.referenceNumber, req.user.id]
  );
  const sub = rows[0];
  if (!sub) return res.status(404).json({ error: 'Not found' });

  const { rows: partyVotes } = await pool.query(
    `SELECT pp.id AS party_id, pp.name, pp.abbreviation, spv.votes
     FROM submission_party_votes spv
     JOIN political_parties pp ON pp.id = spv.party_id
     WHERE spv.submission_id = $1
     ORDER BY pp.is_priority DESC, pp.display_order ASC`,
    [sub.id]
  );

  const { rows: corrections } = await pool.query(
    `SELECT cr.id, cr.status, cr.reason, cr.created_at, cr.decided_at, cr.rejection_reason,
            cr.original_registered, cr.original_accredited, cr.original_invalid,
            cr.original_party_votes, cr.proposed_registered, cr.proposed_accredited,
            cr.proposed_invalid, cr.proposed_party_votes, cr.applied_result_id,
            a.full_name AS decided_by_name
     FROM correction_requests cr
     LEFT JOIN users a ON a.id = cr.decided_by
     WHERE cr.submission_id = $1
     ORDER BY cr.created_at DESC`,
    [sub.id]
  );

  res.json({
    id: sub.id,
    referenceNumber: sub.reference_number,
    status: sub.status,
    createdAt: sub.created_at,
    supersededBy: sub.superseded_by,
    correctedBy: sub.corrected_by,
    pollingUnit: { id: sub.polling_unit_id, name: sub.pu_name, number: sub.pu_number },
    ward: sub.ward_name,
    lga: sub.lga_name,
    totals: {
      registered: sub.total_registered_voters,
      accredited: sub.total_accredited_voters,
      valid: sub.total_valid_votes,
      invalid: sub.total_invalid_votes,
      total: sub.total_votes,
    },
    partyVotes,
    corrections: corrections.map((c) => ({
      ...c,
      original_party_votes: c.original_party_votes || {},
      proposed_party_votes: c.proposed_party_votes || {},
    })),
  });
});

// SEC-4 — an agent reports a mistake in their own already-submitted result.
// NOT an edit: the original row is never touched. The proposed values are
// stored as a PENDING correction request that only an authorized admin may
// approve (which creates a superseding official result) or reject (original
// stays). The backend verifies ownership, eligibility, pending-duplicates,
// reason quality and the full result validation rules.
router.post(
  '/:id/correction-request',
  requireAuth,
  requireRole('agent'),
  requireAgentPortalActive,
  upload.fields([{ name: 'evidencePhoto', maxCount: 1 }]),
  validateCorrectionProposal,
  async (req, res) => {
    const d = req.correction;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the submission row so two simultaneous correction attempts can't
      // both pass the pending check below (the partial unique index on
      // pending requests is the second line of defence).
      const { rows: subRows } = await client.query(
        `SELECT s.* FROM submissions s WHERE s.id = $1 FOR UPDATE OF s`,
        [req.params.id]
      );
      const submission = subRows[0];
      if (!submission) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Result not found' });
      }
      // Only the agent who submitted this result may report an error in it.
      if (submission.agent_id !== req.user.id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You may only request a correction for your own submitted result' });
      }
      // The result must still be the incumbent official record for its PU —
      // already-corrected originals are archived and no longer stand.
      if (submission.duplicate_of) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This result is a flagged duplicate and cannot be corrected by its agent' });
      }
      if (submission.superseded_by) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This result has already been corrected and superseded; the approved correction is now official' });
      }

      // One active correction request per submitted result.
      const { rows: pendingRows } = await client.query(
        `SELECT id FROM correction_requests WHERE submission_id = $1 AND status = 'pending' FOR UPDATE`,
        [submission.id]
      );
      if (pendingRows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'A correction request is already pending for this result — it must be reviewed by an administrator first.' });
      }

      // Original immutable snapshot taken at request time (audit).
      const { rows: partyRows } = await client.query(
        `SELECT party_id, votes FROM submission_party_votes WHERE submission_id = $1`,
        [submission.id]
      );
      const original = {
        totalRegisteredVoters: submission.total_registered_voters,
        totalAccreditedVoters: submission.total_accredited_voters,
        totalInvalidVotes: submission.total_invalid_votes,
        partyVotes: partyRows,
      };
      if (!resultsDiffer(original, d)) {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: 'The proposed result is identical to the original — enter the corrected figures.' });
      }

      // The proposed party list must be recognized parties (same check the
      // original submission route applies) so an approved correction can
      // never insert garbage rows under a fake party id.
      const proposedPartyIds = d.partyVotes.map((p) => p.partyId);
      const { rows: knownParties } = await client.query(
        `SELECT id FROM political_parties WHERE id = ANY($1::uuid[])`,
        [proposedPartyIds]
      );
      if (knownParties.length !== proposedPartyIds.length) {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: 'One or more parties in the proposed result were not recognized' });
      }

      // Correction-request location (optional, kept separate from the original
      // submission's capture coordinates which are never overwritten).
      let requestPlace = null;
      if (d.requestLat != null && d.requestLng != null) {
        requestPlace = await reverseGeocodePlace(d.requestLat, d.requestLng);
      }

      const proposedPartyVotes = JSON.stringify(votesToMap(d.partyVotes));
      const originalPartyVotes = JSON.stringify(votesToMap(partyRows));

      const inserted = await client.query(
        `INSERT INTO correction_requests (
           submission_id, original_registered, original_accredited, original_invalid,
           original_party_votes, proposed_registered, proposed_accredited, proposed_invalid,
           proposed_party_votes, reason, requested_by, request_lat, request_lng, request_place
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, status, created_at`,
        [
          submission.id,
          submission.total_registered_voters,
          submission.total_accredited_voters,
          submission.total_invalid_votes,
          originalPartyVotes,
          d.totalRegisteredVoters,
          d.totalAccreditedVoters,
          d.totalInvalidVotes,
          proposedPartyVotes,
          d.reason,
          req.user.id,
          d.requestLat ?? null,
          d.requestLng ?? null,
          requestPlace,
        ]
      );

      // Optional new evidence for the correction — stored separately; the
      // original submission's photos are never replaced.
      const file = req.files?.evidencePhoto?.[0];
      if (file) {
        const scan = await scanFile(file.buffer);
        if (!scan.clean) {
          await client.query('ROLLBACK');
          return res.status(422).json({ error: 'The evidence file failed the security scan' });
        }
        await client.query(
          `INSERT INTO correction_photos (correction_request_id, data, mime_type, size_bytes, captured_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [inserted.rows[0].id, file.buffer, file.mimetype, file.size, new Date()]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({
        id: inserted.rows[0].id,
        status: inserted.rows[0].status,
        referenceNumber: submission.reference_number,
        message: 'Correction request submitted. An administrator will review it — your submitted result remains unchanged until then.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505' && err.constraint === 'one_pending_correction_per_submission') {
        return res.status(409).json({ error: 'A correction request is already pending for this result — it must be reviewed by an administrator first.' });
      }
      console.error(err);
      res.status(500).json({ error: 'Could not save the correction request, please retry' });
    } finally {
      client.release();
    }
  }
);

// Note: intentionally no PUT/PATCH/DELETE here — SEC-3 immutability.
// Corrections must go through a separate /correction-request workflow (SEC-4).

export default router;
