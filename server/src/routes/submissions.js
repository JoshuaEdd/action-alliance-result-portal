import express from 'express';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateSubmission, isOutsideRadius } from '../middleware/validateSubmission.js';
import { upload, scanFile } from '../middleware/upload.js';

const router = express.Router();
const GPS_RADIUS = Number(process.env.GPS_FLAG_RADIUS_METERS || 500);

function generateReferenceNumber() {
  // Short, agent-readable, collision-resistant enough for a confirmation screen
  return `AA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

// FR-2.* — submit a polling-unit result. Multipart: fields + 3 required photos.
router.post(
  '/',
  requireAuth,
  requireRole('agent'),
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
      const scan = await scanFile(files[key][0].path);
      if (!scan.clean) return res.status(422).json({ error: 'A file failed the security scan' });
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
           capture_lat, capture_lng, captured_at, gps_flagged, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
          d.submittingAgentName,
          d.submittingAgentPhone,
          d.captureLat,
          d.captureLng,
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
        await client.query(
          `INSERT INTO submission_photos (submission_id, photo_type, storage_path, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5)`,
          [submission.id, photoType, file.path, file.mimetype, file.size]
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
      console.error(err);
      res.status(500).json({ error: 'Could not save submission, please retry' });
    } finally {
      client.release();
    }
  }
);

// FR-2.13 — agent checks status of their own submission
router.get('/mine/:referenceNumber', requireAuth, requireRole('agent'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT reference_number, status, created_at FROM submissions
     WHERE reference_number = $1 AND agent_id = $2`,
    [req.params.referenceNumber, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// Note: intentionally no PUT/PATCH/DELETE here — SEC-3 immutability.
// Corrections must go through a separate /correction-requests workflow (SEC-4).

export default router;
