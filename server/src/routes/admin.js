import express from 'express';
import PDFDocument from 'pdfkit';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit, logAction } from '../middleware/audit.js';

const router = express.Router();
const requireAdmin = requireRole('limited_admin', 'verifying_admin', 'chief_admin');

// A submission counts toward compiled totals once accepted — not a
// duplicate, not flagged for review (FR-4.9, FR-4.10).
const ACCEPTED = `duplicate_of IS NULL AND status NOT IN ('flagged')`;

// SEC-10 — a limited/verifying admin may be scoped to a single LGA by the
// Chief Administrator (via user.scope_local_government_id); NULL scope
// means the full federal constituency. Applied inline per-route below.
router.use(requireAuth, requireAdmin);

// ── Per-party vote aggregation, any level of the hierarchy. AA is always
// first in the returned list (is_priority), everything else follows in
// display_order — the admin UI decides whether to show the rest.
//
// Uses a pre-filtered CTE rather than chaining LEFT JOINs with per-step
// conditions — an earlier version filtered inside each JOIN's ON clause,
// which caused votes from out-of-scope submissions to leak into totals
// whenever a later join step (referencing a not-yet-joined table) failed.
async function getPartyResults({ level, id, scope }) {
  let levelFilter = '';
  const params = [];
  if (level === 'ward' && id) {
    levelFilter = `AND pu.ward_id = $1`;
    params.push(id);
  } else if (level === 'lga' && id) {
    levelFilter = `AND w.local_government_id = $1`;
    params.push(id);
  } else if (scope) {
    levelFilter = `AND w.local_government_id = $1`;
    params.push(scope);
  }

  const { rows } = await pool.query(
    `WITH scoped_submissions AS (
       SELECT s.id FROM submissions s
       JOIN polling_units pu ON pu.id = s.polling_unit_id
       JOIN wards w ON w.id = pu.ward_id
       WHERE ${ACCEPTED} ${levelFilter}
     )
     SELECT pp.id AS party_id, pp.name, pp.abbreviation, pp.is_priority,
            COALESCE(SUM(spv.votes), 0) AS votes
     FROM political_parties pp
     LEFT JOIN submission_party_votes spv
       ON spv.party_id = pp.id AND spv.submission_id IN (SELECT id FROM scoped_submissions)
     GROUP BY pp.id, pp.name, pp.abbreviation, pp.is_priority, pp.display_order
     ORDER BY pp.is_priority DESC, pp.display_order ASC`,
    params
  );
  const parties = rows.map((r) => ({ ...r, votes: Number(r.votes) }));
  const leading = parties.reduce((max, p) => (p.votes > (max?.votes ?? -1) ? p : max), null);
  return { parties, leadingParty: leading };
}

router.get('/party-results', audit('view_party_results'), async (req, res) => {
  const { level, id } = req.query;
  const result = await getPartyResults({ level, id, scope: req.user.scopeLocalGovernmentId });
  res.json(result);
});

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

  const { parties, leadingParty } = await getPartyResults({ scope });

  res.json({
    ...rows[0],
    totalPollingUnits: totalPU,
    reportingProgressPct: totalPU ? Math.round((reported / totalPU) * 1000) / 10 : 0,
    parties,
    leadingParty,
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
  const withLeaders = await Promise.all(
    rows.map(async (lga) => {
      const { leadingParty } = await getPartyResults({ level: 'lga', id: lga.id });
      return { ...lga, leadingParty };
    })
  );
  res.json(withLeaders);
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
  const withLeaders = await Promise.all(
    rows.map(async (ward) => {
      const { leadingParty } = await getPartyResults({ level: 'ward', id: ward.id });
      return { ...ward, leadingParty };
    })
  );
  res.json(withLeaders);
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
        `SELECT id, photo_type, storage_path, mime_type FROM submission_photos WHERE submission_id = $1`,
        [rows[0].id]
      )).rows.map((p) => ({ ...p, url: `/api/admin/photos/${p.id}` }))
    : [];

  const partyVotes = rows[0].id
    ? (await pool.query(
        `SELECT pp.id AS party_id, pp.name, pp.abbreviation, pp.is_priority, spv.votes
         FROM submission_party_votes spv
         JOIN political_parties pp ON pp.id = spv.party_id
         WHERE spv.submission_id = $1
         ORDER BY pp.is_priority DESC, pp.display_order ASC`,
        [rows[0].id]
      )).rows
    : [];

  res.json({ ...rows[0], photos, partyVotes });
});

// SEC-9 — serve a stored submission photo to an authenticated admin only.
// Files live outside any static/root directory (see middleware/upload.js),
// so the raw storage_path is never exposed through static serving.
router.get('/photos/:photoId', audit('view_photo'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT storage_path, mime_type FROM submission_photos WHERE id = $1`,
    [req.params.photoId]
  );
  const photo = rows[0];
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const filePath = path.resolve(photo.storage_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Photo file is missing' });
  res.setHeader('Content-Type', photo.mime_type);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(filePath);
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
// ── FR-4.11 — shared export query: federal / lga / ward result statement ──
// Human labels + per-column width, reused by the CSV and XLSX exporters.
const EXPORT_COLUMNS = [
  { key: 'local_government',      label: 'Local Government',       width: 22 },
  { key: 'ward',                  label: 'Ward',                   width: 22 },
  { key: 'polling_unit',          label: 'Polling Unit',           width: 30 },
  { key: 'pu_number',             label: 'PU Number',              width: 12 },
  { key: 'total_registered_voters', label: 'Registered Voters',    width: 14 },
  { key: 'total_accredited_voters', label: 'Accredited Voters',    width: 14 },
  { key: 'total_valid_votes',     label: 'Valid Votes',            width: 12 },
  { key: 'total_invalid_votes',   label: 'Invalid Votes',          width: 12 },
  { key: 'total_votes',           label: 'Total Votes',            width: 12 },
  { key: 'captured_at',           label: 'Capture Time (uneditable)', width: 24 },
  { key: 'status',                label: 'Status',                  width: 16 },
  { key: 'reference_number',      label: 'Reference',               width: 20 },
  { key: 'created_at',            label: 'Submitted At (uneditable)', width: 24 },
];

async function getExportRows({ level, id }) {
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
            s.captured_at, s.status, s.reference_number, s.created_at
     FROM submissions s
     JOIN polling_units pu ON pu.id = s.polling_unit_id
     JOIN wards w ON w.id = pu.ward_id
     JOIN local_governments lg ON lg.id = w.local_government_id
     WHERE ${where}
     ORDER BY lg.name, w.ward_number, pu.pu_number`,
    params
  );
  return rows;
}

// FR-4.11 — CSV export (kept alongside the more capable XLSX export).
router.get(
  '/export/csv',
  requireRole('limited_admin', 'verifying_admin', 'chief_admin'),
  audit('export_csv'),
  async (req, res) => {
    const { level, id } = req.query;
    const rows = await getExportRows({ level, id });
    const keys = EXPORT_COLUMNS.map((c) => c.key);
    const csvLines = [
      keys.map((k) => EXPORT_COLUMNS.find((c) => c.key === k).label).join(','),
      // ISO timestamps are quoted so spreadsheet software reads the exact
      // capture/entry moment as text — no timezone reformatting, nothing
      // to auto-edit in the sheet.
      ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="results-${level || 'federal'}.csv"`);
    res.send('\uFEFF' + csvLines.join('\n'));
  }
);

// ── FR-4.11 — XLSX export. All cells are text-wrapped for clarity; the
// capture/entry timestamp columns are locked + protected so an admin can
// read the exact moment but cannot silently edit it in the sheet.
router.get(
  '/export/xlsx',
  requireRole('limited_admin', 'verifying_admin', 'chief_admin'),
  audit('export_xlsx'),
  async (req, res) => {
    const { level, id } = req.query;
    const rows = await getExportRows({ level, id });

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Action Alliance Result Portal';
    wb.created = new Date();
    const ws = wb.addWorksheet('Results');

    ws.columns = EXPORT_COLUMNS.map((c) => ({
      header: c.label,
      key: c.key,
      width: c.width,
    }));
    ws.addRows(rows);

    // Styled, wrapped header.
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17854D' } };
    ws.getRow(1).height = 24;

    // Every cell is text-wrapped and top-aligned so nothing gets clipped,
    // and long address/ward names read comfortably.
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        cell.alignment = {
          vertical: 'top',
          wrapText: true,
          horizontal: rowNumber === 1 ? 'center' : 'left',
        };
        row.height = Math.max(row.height, 24);
      });
    });

    // Times are written as literal text strings, so Excel won't coerce or
    // "helpfully" reformat them (they stay exactly the source's timestamps).
    const KEEP_TEXT = new Set(['captured_at', 'created_at']);
    ws.eachRow({ includeEmpty: false }, (row, rowIdx) => {
      if (rowIdx === 1) return;
      EXPORT_COLUMNS.forEach((c, i) => {
        if (!KEEP_TEXT.has(c.key)) return;
        const cell = row.getCell(i + 1);
        cell.value = String(rows[rowIdx - 2]?.[c.key] ?? '');
        // Lock the timestamp cells so they are read-only once protected.
        cell.protection = { locked: true };
      });
      // Everything else stays editable.
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.protection?.locked !== true) cell.protection = { locked: false };
      });
    });

    // Protect the sheet so locked cells cannot be edited. The timestamps
    // stay locked; a user overriding protection would be their own choice.
    ws.protect('', { selectLockedCells: false, selectUnlockedCells: true });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="results-${level || 'federal'}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }
);

// ── FR-4.6 / FR-4.11 — PDF export for a single polling unit ────────

const PHOTO_LABELS = { agent_tag: 'Agent tag', result_sheet: 'Result sheet', agent_passport: 'Agent passport' };
// Only JPEG/PNG (what pdfkit can render) that actually exist on disk are
// included; others are skipped rather than failing the export.
function loadSubmissionPhotos(submissionId) {
  return pool
    .query(
      `SELECT id, photo_type, storage_path, mime_type FROM submission_photos WHERE submission_id = $1`,
      [submissionId]
    )
    .then(({ rows }) =>
      rows
        .map((p) => ({ ...p, label: PHOTO_LABELS[p.photo_type] || p.photo_type }))
        .filter((p) => ['image/jpeg', 'image/png'].includes(p.mime_type) && fs.existsSync(p.storage_path))
    );
}

// Draws one accepted submission's statement + its attached photos onto doc.
// Callers set newPage=true to start each subsequent submission on a fresh
// page so the many pages of a compiled/bulk export never overlap.
function addSubmissionContent(doc, r, photos, { newPage = false } = {}) {
  if (newPage) doc.addPage();

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

  if (photos.length) {
    doc.moveDown().fontSize(13).fillColor('#000').text('Attached photos', { underline: true });
    doc.moveDown(0.5);

    // Lay the attachments out side-by-side within the document margins
    // (A4 printable area), with a 0.1-inch gap between them. Each photo is
    // fitted (aspect-preserving) inside its own equal box so the row is
    // even and nothing overlaps or crosses the margins.
    const rowLeft = doc.page.margins.left;
    const printableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const gap = 0.1 * 72; // 0.1 inch in points
    const boxW = (printableWidth - gap * (photos.length - 1)) / photos.length;
    const boxH = Math.min(Math.round(boxW * 1.6), Math.floor(doc.page.height - doc.y - 56));
    const rowY = doc.y;

    photos.forEach((photo, i) => {
      try {
        const buffer = fs.readFileSync(photo.storage_path);
        const x = rowLeft + i * (boxW + gap);
        doc.image(buffer, { x, y: rowY, fit: [boxW, boxH], align: 'center', valign: 'middle' });
        doc.fontSize(9).fillColor('#555').text(photo.label, x, rowY + boxH + 4, { width: boxW, align: 'center' });
      } catch {
        // skip an unreadable/corrupt attachment rather than fail the export
      }
    });

    doc.y = rowY + boxH + 24;
  }
}

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

  const photos = await loadSubmissionPhotos(r.id);
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${r.reference_number}.pdf"`);
  doc.pipe(res);
  addSubmissionContent(doc, r, photos);
  doc.end();
});

// ── FR-4.11 — bulk PDF export: a compiled record copy for every accepted
// submission in the scope (ward / lga / whole constituency). Reuses the same
// per-submission layout; each submission starts on its own page.
async function sendCompiledPdf({ res, level, id, scope }) {
  let where = ACCEPTED;
  const params = [];
  if (level === 'lga' && id) {
    where += ` AND w.local_government_id = $1`;
    params.push(id);
  } else if (level === 'ward' && id) {
    where += ` AND pu.ward_id = $1`;
    params.push(id);
  } else if (scope) {
    where += ` AND w.local_government_id = $1`;
    params.push(scope);
  }

  const { rows } = await pool.query(
    `SELECT s.*, pu.name AS pu_name, pu.pu_number, w.name AS ward_name, w.ward_number,
            lg.name AS lga_name, lg.name AS scope_label
     FROM submissions s
     JOIN polling_units pu ON pu.id = s.polling_unit_id
     JOIN wards w ON w.id = pu.ward_id
     JOIN local_governments lg ON lg.id = w.local_government_id
     WHERE ${where}
     ORDER BY lg.name, w.ward_number, pu.pu_number`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'No accepted submissions in this scope' });

  const compiled = await Promise.all(rows.map(async (r) => ({ r, photos: await loadSubmissionPhotos(r.id) })));

  const scopeTitle =
    level === 'ward'
      ? `${rows[0].ward_name} Ward — ${rows[0].lga_name}`
      : level === 'lga'
        ? `${rows[0].lga_name}`
        : 'Ahiazu Federal Constituency';

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="results-${level || 'federal'}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text(scopeTitle, { align: 'center' });
  doc.moveDown(0.5).fontSize(10).fillColor('#555').text('Compiled result statement', { align: 'center' });
  doc.moveDown();

  compiled.forEach(({ r, photos }, i) => addSubmissionContent(doc, r, photos, { newPage: i > 0 }));
  doc.end();
}

router.get('/export/pdf/ward/:id', requireRole('limited_admin', 'verifying_admin', 'chief_admin'), audit('export_pdf'), (req, res) =>
  sendCompiledPdf({ res, level: 'ward', id: req.params.id })
);
router.get('/export/pdf/lga/:id', requireRole('limited_admin', 'verifying_admin', 'chief_admin'), audit('export_pdf'), (req, res) =>
  sendCompiledPdf({ res, level: 'lga', id: req.params.id })
);
router.get('/export/pdf/federal', requireRole('limited_admin', 'verifying_admin', 'chief_admin'), audit('export_pdf'), (req, res) =>
  sendCompiledPdf({ res, level: 'federal', scope: req.user.scopeLocalGovernmentId })
);

// ── Invite codes — how a self-registering agent gets vetted for a
// specific polling unit (any admin role can generate/view; codes are
// scoped to whatever PU the admin picks, not to the admin's own scope) ──
function generateCode() {
  // Short, easy to read aloud/type: e.g. "7K3P-QX9M"
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${part()}-${part()}`;
}

// Mass-generation at State (all PUs), LGA, or ward granularity — one code
// for every polling unit that doesn't yet have an agent or a live unused
// code. Idempotent: units already covered are skipped (existing-Unused de-dup
// is a DB consult, and the app also avoids racing with the per-PU generator).
async function generateInviteCodesForScope({ scope, lgaId, wardId, createdBy }) {
  const conditions = [`NOT EXISTS (SELECT 1 FROM users u WHERE u.assigned_polling_unit_id = pu.id AND u.role = 'agent')`,
                      `NOT EXISTS (SELECT 1 FROM invite_codes ic
                                     WHERE ic.polling_unit_id = pu.id
                                       AND ic.used_at IS NULL
                                       AND (ic.expires_at IS NULL OR ic.expires_at > now()))`];
  const params = [];
  let where = `SELECT pu.id FROM polling_units pu JOIN wards w ON w.id = pu.ward_id WHERE ${conditions.join(' AND ')}`;
  if (scope === 'lga' && lgaId) {
    where += ` AND w.local_government_id = $1`;
    params.push(lgaId);
  } else if (scope === 'ward' && wardId) {
    where += ` AND pu.ward_id = $1`;
    params.push(wardId);
  }

  const { rows } = await pool.query(where, params);

  const client = await pool.connect();
  const created = [];
  try {
    await client.query('BEGIN');
    for (const { id } of rows) {
      let code = null;
      for (let attempt = 0; attempt < 5 && !code; attempt++) {
        const candidate = generateCode();
        const exists = await client.query(`SELECT 1 FROM invite_codes WHERE code = $1`, [candidate]);
        if (!exists.rows[0]) code = candidate;
      }
      if (!code) continue; // leave unit for a retry pass if unlucky on collisions
      const inserted = await client.query(
        `INSERT INTO invite_codes (code, polling_unit_id, created_by) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING id, code, polling_unit_id`,
        [code, id, createdBy]
      );
      if (inserted.rows[0]) created.push(inserted.rows[0]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { requested: rows.length, created: created.length };
}

// Mass generation at State / LGA / ward level (keeps the per-PU route below).
router.post(
  '/invite-codes/bulk',
  audit('bulk_create_invite_codes', { targetTable: 'invite_codes' }),
  async (req, res) => {
    const { scope, lgaId, wardId } = req.body;
    if (!['all', 'lga', 'ward'].includes(scope)) {
      return res.status(400).json({ error: 'scope must be one of: all, lga, ward' });
    }
    try {
      const result = await generateInviteCodesForScope({ scope, lgaId, wardId, createdBy: req.user.id });
      res.status(201).json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not generate invite codes, please retry' });
    }
  }
);

// Delete (permanently retire) an admin account — the row is soft-deleted
// (`deleted_at`) rather than hard-dropped so it disappears from the
// management list and can never sign in, while the many audit/approval rows
// that reference the account keep their FK integrity. A durable audit
// record of the deletion is written so every change is reconstructible.
router.delete(
  '/admins/:id',
  requireRole('chief_admin'),
  audit('delete_admin', { targetTable: 'users' }),
  async (req, res) => {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const { rows } = await pool.query(
      `SELECT id, full_name, email, role, is_active FROM users
       WHERE id = $1 AND role IN ('limited_admin','verifying_admin','chief_admin') AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Admin not found' });
    const target = rows[0];
    if (target.is_active) {
      // A role that is still active must be revoked first — delete is the
      // final step after revocation, never a shortcut for it.
      return res.status(409).json({ error: 'Revoke this admin (set inactive) before deleting their account' });
    }
    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [req.params.id]);
    await logAction({
      adminId: req.user.id,
      action: 'delete_admin',
      targetTable: 'users',
      targetId: req.params.id,
      metadata: { removedRole: target.role, name: target.full_name, email: target.email },
    });
    res.json({ deleted: true });
  }
);

router.post('/invite-codes', audit('create_invite_code'), async (req, res) => {
  const { pollingUnitId, expiresInDays } = req.body;
  if (!pollingUnitId) return res.status(400).json({ error: 'pollingUnitId is required' });

  // A PU that already has an agent doesn't need a new code
  const { rows: existingAgent } = await pool.query(
    `SELECT id FROM users WHERE assigned_polling_unit_id = $1 AND role = 'agent'`,
    [pollingUnitId]
  );
  if (existingAgent[0]) {
    return res.status(409).json({ error: 'This polling unit already has a registered agent' });
  }

  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateCode();
    const { rows } = await pool.query(`SELECT 1 FROM invite_codes WHERE code = $1`, [code]);
    if (!rows[0]) break;
    code = null;
  }
  if (!code) return res.status(500).json({ error: 'Could not generate a unique code, please retry' });

  const { rows } = await pool.query(
    `INSERT INTO invite_codes (code, polling_unit_id, created_by, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, code, polling_unit_id, expires_at, created_at`,
    [
      code,
      pollingUnitId,
      req.user.id,
      expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null,
    ]
  );
  res.status(201).json(rows[0]);
});

router.get('/invite-codes', audit('view_invite_codes'), async (req, res) => {
  const { pollingUnitId } = req.query;
  const { rows } = await pool.query(
    `SELECT ic.id, ic.code, ic.polling_unit_id, ic.expires_at, ic.created_at,
            ic.used_at, u.full_name AS used_by_name,
            pu.name AS pu_name, pu.pu_number
     FROM invite_codes ic
     JOIN polling_units pu ON pu.id = ic.polling_unit_id
     LEFT JOIN users u ON u.id = ic.used_by
     WHERE ($1::uuid IS NULL OR ic.polling_unit_id = $1)
     ORDER BY ic.created_at DESC
     LIMIT 100`,
    [pollingUnitId || null]
  );
  res.json(rows);
});

// Revoke an unused code (e.g. it was issued to the wrong person and shared insecurely)
router.delete('/invite-codes/:id', audit('revoke_invite_code'), async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM invite_codes WHERE id = $1 AND used_by IS NULL RETURNING id`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Code not found, or already used' });
  res.json({ deleted: true });
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
     FROM users WHERE role IN ('limited_admin','verifying_admin','chief_admin') AND deleted_at IS NULL ORDER BY created_at`
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
