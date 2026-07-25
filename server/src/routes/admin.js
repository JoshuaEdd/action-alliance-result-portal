import express from 'express';
import PDFDocument from 'pdfkit';
import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = express.Router();
const requireAdmin = requireRole('limited_admin', 'verifying_admin', 'chief_admin');

// A submission counts toward compiled totals once accepted — not a
// duplicate, not flagged for review (FR-4.9, FR-4.10).
const ACCEPTED = `duplicate_of IS NULL AND status NOT IN ('flagged')`;

// SEC-10 — a limited/verifying admin may be scoped to a single LGA by the
// Chief Administrator (via user.scope_local_government_id); NULL scope
// means the full federal constituency. Applied inline per-route below.
router.use(requireAuth, requireAdmin);

// ── FR-4.1 — home dashboard compendium ────────────────────────────
router.get('/summary', audit('view_summary'), async (req, res) => {
  const scope = req.user.scopeLocalGovernmentId;
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(s.total_registered_voters),0) AS total_registered_voters,
       COALESCE(SUM(s.total_accredited_voters),0) AS total_accredited_voters,
       COALESCE(SUM(s.total_valid_votes),0) AS total_valid_votes,
       COALESCE(SUM(s.total_invalid_votes),0) AS total_invalid_votes,
       COALESCE(SUM(s.total_votes),0) AS total_votes,
       COUNT(*) AS polling_units_reported
     FROM submissions s
     JOIN polling_units pu ON pu.id = s.polling_unit_id
     JOIN wards w ON w.id = pu.ward_id
     WHERE ${ACCEPTED} ${scope ? 'AND w.local_government_id = $1' : ''}`,
    scope ? [scope] : []
  );

  const { rows: totalPuRows } = await pool.query(
    `SELECT COUNT(*) AS total_polling_units FROM polling_units pu
     JOIN wards w ON w.id = pu.ward_id
     WHERE 1=1 ${scope ? 'AND w.local_government_id = $1' : ''}`,
    scope ? [scope] : []
  );

  // FR-4.12 — reporting progress, not raw totals alone
  const reported = Number(rows[0].polling_units_reported);
  const totalPU = Number(totalPuRows[0].total_polling_units);

  res.json({
    ...rows[0],
    totalPollingUnits: totalPU,
    reportingProgressPct: totalPU ? Math.round((reported / totalPU) * 1000) / 10 : 0,
  });
});

// ── FR-4.2 — compiled results per local government ────────────────
router.get('/local-governments', audit('view_lga_list'), async (req, res) => {
  const scope = req.user.scopeLocalGovernmentId;
  const { rows } = await pool.query(
    `SELECT lg.id, lg.name,
            COUNT(DISTINCT pu.id) AS total_polling_units,
            COUNT(DISTINCT s.polling_unit_id) FILTER (WHERE ${ACCEPTED}) AS reported_polling_units,
            COALESCE(SUM(s.total_votes) FILTER (WHERE ${ACCEPTED}), 0) AS total_votes
     FROM local_governments lg
     LEFT JOIN wards w ON w.local_government_id = lg.id
     LEFT JOIN polling_units pu ON pu.ward_id = w.id
     LEFT JOIN submissions s ON s.polling_unit_id = pu.id
     WHERE 1=1 ${scope ? 'AND lg.id = $1' : ''}
     GROUP BY lg.id, lg.name
     ORDER BY lg.name`,
    scope ? [scope] : []
  );
  res.json(rows);
});

// ── FR-4.3 — compiled results per ward within an LGA ───────────────
router.get('/local-governments/:lgaId/wards', audit('view_ward_list'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT w.id, w.name, w.ward_number,
            COUNT(DISTINCT pu.id) AS total_polling_units,
            COUNT(DISTINCT s.polling_unit_id) FILTER (WHERE ${ACCEPTED}) AS reported_polling_units,
            COALESCE(SUM(s.total_votes) FILTER (WHERE ${ACCEPTED}), 0) AS total_votes
     FROM wards w
     LEFT JOIN polling_units pu ON pu.ward_id = w.id
     LEFT JOIN submissions s ON s.polling_unit_id = pu.id
     WHERE w.local_government_id = $1
     GROUP BY w.id, w.name, w.ward_number
     ORDER BY w.ward_number`,
    [req.params.lgaId]
  );
  res.json(rows);
});

// ── FR-4.4 — compiled results per polling unit within a ward ───────
router.get('/wards/:wardId/polling-units', audit('view_pu_list'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pu.id, pu.name, pu.pu_number,
            s.id AS submission_id, s.status, s.total_votes, s.gps_flagged, s.created_at
     FROM polling_units pu
     LEFT JOIN submissions s ON s.polling_unit_id = pu.id AND ${ACCEPTED}
     WHERE pu.ward_id = $1
     ORDER BY pu.pu_number`,
    [req.params.wardId]
  );
  res.json(rows);
});

// ── FR-4.6 — full submitted detail for one polling unit ────────────
router.get('/polling-units/:id', audit('view_pu_detail'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, pu.name AS pu_name, pu.pu_number, w.name AS ward_name, lg.name AS lga_name,
            a.full_name AS agent_account_name
     FROM polling_units pu
     JOIN wards w ON w.id = pu.ward_id
     JOIN local_governments lg ON lg.id = w.local_government_id
     LEFT JOIN submissions s ON s.polling_unit_id = pu.id AND ${ACCEPTED}
     LEFT JOIN users a ON a.id = s.agent_id
     WHERE pu.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Polling unit not found' });

  const photos = rows[0].id
    ? (await pool.query(
        `SELECT photo_type, storage_path, mime_type FROM submission_photos WHERE submission_id = $1`,
        [rows[0].id]
      )).rows
    : [];

  res.json({ ...rows[0], photos });
});

// ── FR-4.8 — quick search across LGA / ward / polling unit names ───
router.get('/search', audit('search'), async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const { rows } = await pool.query(
    `SELECT 'polling_unit' AS type, pu.id, pu.name, pu.pu_number AS number,
            w.name AS ward_name, lg.name AS lga_name, lg.id AS lga_id, w.id AS ward_id
     FROM polling_units pu
     JOIN wards w ON w.id = pu.ward_id
     JOIN local_governments lg ON lg.id = w.local_government_id
     WHERE pu.name ILIKE $1 OR pu.pu_number ILIKE $1
     UNION ALL
     SELECT 'ward', w.id, w.name, w.ward_number, NULL, lg.name, lg.id, w.id
     FROM wards w JOIN local_governments lg ON lg.id = w.local_government_id
     WHERE w.name ILIKE $1
     UNION ALL
     SELECT 'local_government', lg.id, lg.name, NULL, NULL, lg.name, lg.id, NULL
     FROM local_governments lg WHERE lg.name ILIKE $1
     LIMIT 20`,
    [q]
  );
  res.json(rows);
});

// ── FR-4.11 — CSV export per selected level ─────────────────────────
router.get(
  '/export/csv',
  requireRole('limited_admin', 'verifying_admin', 'chief_admin'),
  audit('export_csv'),
  async (req, res) => {
    const { level, id } = req.query; // level: 'federal' | 'lga' | 'ward'
    let where = ACCEPTED;
    const params = [];
    if (level === 'lga' && id) {
      where += ` AND w.local_government_id = $1`;
      params.push(id);
    } else if (level === 'ward' && id) {
      where += ` AND pu.ward_id = $1`;
      params.push(id);
    }

    const { rows } = await pool.query(
      `SELECT lg.name AS local_government, w.name AS ward, pu.name AS polling_unit, pu.pu_number,
              s.total_registered_voters, s.total_accredited_voters,
              s.total_valid_votes, s.total_invalid_votes, s.total_votes,
              s.status, s.reference_number, s.created_at
       FROM submissions s
       JOIN polling_units pu ON pu.id = s.polling_unit_id
       JOIN wards w ON w.id = pu.ward_id
       JOIN local_governments lg ON lg.id = w.local_government_id
       WHERE ${where}
       ORDER BY lg.name, w.ward_number, pu.pu_number`,
      params
    );

    const header = Object.keys(rows[0] || {
      local_government: '', ward: '', polling_unit: '', pu_number: '',
      total_registered_voters: '', total_accredited_voters: '', total_valid_votes: '',
      total_invalid_votes: '', total_votes: '', status: '', reference_number: '', created_at: '',
    });
    const csvLines = [
      header.join(','),
      ...rows.map((r) => header.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="results-${level || 'federal'}.csv"`);
    res.send(csvLines.join('\n'));
  }
);

// ── FR-4.6 / FR-4.11 — PDF export for a single polling unit ────────
router.get('/export/pdf/polling-units/:id', audit('export_pdf'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, pu.name AS pu_name, pu.pu_number, w.name AS ward_name, lg.name AS lga_name
     FROM submissions s
     JOIN polling_units pu ON pu.id = s.polling_unit_id
     JOIN wards w ON w.id = pu.ward_id
     JOIN local_governments lg ON lg.id = w.local_government_id
     WHERE s.polling_unit_id = $1 AND ${ACCEPTED}`,
    [req.params.id]
  );
  const r = rows[0];
  if (!r) return res.status(404).json({ error: 'No accepted submission for this polling unit' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${r.reference_number}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  doc.fontSize(16).text('Polling Unit Result — Record Copy', { underline: true });
  doc.moveDown();
  doc.fontSize(10).fillColor('#555').text(`Reference: ${r.reference_number}`);
  doc.text(`${r.lga_name} > ${r.ward_name} > ${r.pu_name} (PU ${r.pu_number})`);
  doc.moveDown();
  doc.fillColor('#000').fontSize(12);
  [
    ['Registered voters', r.total_registered_voters],
    ['Accredited voters', r.total_accredited_voters],
    ['Valid votes', r.total_valid_votes],
    ['Invalid votes', r.total_invalid_votes],
    ['Total votes', r.total_votes],
    ['Submitted', new Date(r.created_at).toLocaleString()],
    ['Status', r.status],
  ].forEach(([label, value]) => doc.text(`${label}: ${value}`));
  doc.end();
});

// ── SEC-4 — correction request workflow (never a direct edit) ──────
router.post('/correction-requests', audit('create_correction_request'), async (req, res) => {
  const { submissionId, fieldName, proposedValue, reason } = req.body;
  if (!submissionId || !fieldName || proposedValue === undefined || !reason) {
    return res.status(400).json({ error: 'submissionId, fieldName, proposedValue, and reason are required' });
  }
  const { rows } = await pool.query(`SELECT * FROM submissions WHERE id = $1`, [submissionId]);
  const submission = rows[0];
  if (!submission) return res.status(404).json({ error: 'Submission not found' });
  if (!(fieldName in submission)) return res.status(400).json({ error: 'Unknown field' });

  const { rows: inserted } = await pool.query(
    `INSERT INTO correction_requests (submission_id, field_name, original_value, proposed_value, reason, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [submissionId, fieldName, String(submission[fieldName]), String(proposedValue), reason, req.user.id]
  );
  res.status(201).json(inserted[0]);
});

router.get('/correction-requests', audit('view_correction_requests'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT cr.*, s.reference_number,
            (SELECT COUNT(*) FROM correction_approvals ca WHERE ca.correction_request_id = cr.id AND ca.approved) AS approvals,
            (SELECT COUNT(*) FROM users WHERE role IN ('limited_admin','verifying_admin','chief_admin')) AS admins_required
     FROM correction_requests cr
     JOIN submissions s ON s.id = cr.submission_id
     ORDER BY cr.created_at DESC`
  );
  res.json(rows);
});

// SEC-4 — must be approved by *all* administrators in the system, and only
// verifying/chief admins may record a decision (SEC-10 permission matrix).
router.post(
  '/correction-requests/:id/decision',
  requireRole('verifying_admin', 'chief_admin'),
  audit('decide_correction_request'),
  async (req, res) => {
    const { approved } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO correction_approvals (correction_request_id, admin_id, approved)
         VALUES ($1, $2, $3)
         ON CONFLICT (correction_request_id, admin_id) DO UPDATE SET approved = $3, decided_at = now()`,
        [req.params.id, req.user.id, !!approved]
      );

      if (!approved) {
        await client.query(`UPDATE correction_requests SET status = 'rejected' WHERE id = $1`, [req.params.id]);
        await client.query('COMMIT');
        return res.json({ status: 'rejected' });
      }

      const { rows: countRows } = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE role IN ('limited_admin','verifying_admin','chief_admin')) AS required,
           (SELECT COUNT(*) FROM correction_approvals WHERE correction_request_id = $1 AND approved) AS given`,
        [req.params.id]
      );
      const { required, given } = countRows[0];

      if (Number(given) >= Number(required)) {
        // Note: submissions stay immutable rows — recording the approved
        // correction here is a placeholder; applying it requires a
        // superseding-record strategy so the original stays untouched,
        // which should be finalized with the security team before go-live.
        await client.query(`UPDATE correction_requests SET status = 'approved' WHERE id = $1`, [req.params.id]);
        await client.query('COMMIT');
        return res.json({ status: 'approved' });
      }

      await client.query('COMMIT');
      res.json({ status: 'pending', approvalsGiven: given, approvalsRequired: required });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Could not record decision' });
    } finally {
      client.release();
    }
  }
);

// ── SEC-10 — administrator account management (Chief Admin only) ──
router.get('/admins', requireRole('chief_admin'), audit('view_admins'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, email, phone_number, role, scope_local_government_id, is_active, created_at
     FROM users WHERE role IN ('limited_admin','verifying_admin','chief_admin') ORDER BY created_at`
  );
  res.json(rows);
});

router.post('/admins', requireRole('chief_admin'), audit('create_admin'), async (req, res) => {
  const { fullName, email, role, scopeLocalGovernmentId, temporaryPassword } = req.body;
  if (!fullName || !email || !role || !temporaryPassword) {
    return res.status(400).json({ error: 'fullName, email, role, and temporaryPassword are required' });
  }
  if (!['limited_admin', 'verifying_admin', 'chief_admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (role, full_name, email, password_hash, scope_local_government_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, full_name, email, role`,
    [role, fullName, email, passwordHash, scopeLocalGovernmentId || null]
  );
  res.status(201).json(rows[0]);
});

router.patch('/admins/:id', requireRole('chief_admin'), audit('update_admin'), async (req, res) => {
  const { role, scopeLocalGovernmentId, isActive } = req.body;
  const { rows } = await pool.query(
    `UPDATE users SET
       role = COALESCE($1, role),
       scope_local_government_id = COALESCE($2, scope_local_government_id),
       is_active = COALESCE($3, is_active)
     WHERE id = $4 AND role IN ('limited_admin','verifying_admin','chief_admin')
     RETURNING id, full_name, email, role, is_active`,
    [role || null, scopeLocalGovernmentId ?? null, isActive ?? null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Admin not found' });
  res.json(rows[0]);
});

export default router;
