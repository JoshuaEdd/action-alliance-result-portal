import express from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { reverseGeocodePlace } from '../utils/placeName.js';

const router = express.Router();

// The browse endpoints are public: agent self-registration needs the
// State → LGA → Ward → PU cascade before it has a session. Only names and
// IDs are exposed (all published by INEC anyway); per-unit results stay
// behind auth.
router.get('/local-governments', async (_req, res) => {
  const { rows } = await pool.query(`SELECT id, name FROM local_governments ORDER BY name`);
  res.json(rows);
});

router.get('/local-governments/:lgaId/wards', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, ward_number FROM wards WHERE local_government_id = $1 ORDER BY ward_number`,
    [req.params.lgaId]
  );
  res.json(rows);
});

router.get('/wards/:wardId/polling-units', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, pu_number FROM polling_units WHERE ward_id = $1 ORDER BY pu_number`,
    [req.params.wardId]
  );
  res.json(rows);
});

// FR-2.1/2.2 — an agent's PU is fixed at registration time (via invite
// code) now, so the wizard just needs to display it, not let it be re-picked.
router.get('/my-polling-unit', requireAuth, async (req, res) => {
  if (!req.user.assignedPollingUnitId) {
    return res.status(404).json({ error: 'No polling unit assigned to this account' });
  }
  const { rows } = await pool.query(
    `SELECT pu.id, pu.name, pu.pu_number, w.name AS ward_name, lg.name AS lga_name
     FROM polling_units pu
     JOIN wards w ON w.id = pu.ward_id
     JOIN local_governments lg ON lg.id = w.local_government_id
     WHERE pu.id = $1`,
    [req.user.assignedPollingUnitId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Assigned polling unit not found' });
  res.json(rows[0]);
});

router.get('/parties', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, abbreviation, is_priority FROM political_parties
     ORDER BY is_priority DESC, display_order ASC`
  );
  res.json(rows);
});

// SEC-4/UX — turn a GPS fix into the human-readable place name shown on the
// agent's location chip and burned onto photos. Run through the server, not
// the browser, so Nominatim's CORS/rate limits and an untrusted client can't
// break it; reverseGeocodePlace caches by rounded coords to stay cheap.
router.get('/reverse', requireAuth, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required numeric query parameters' });
  }
  const place = await reverseGeocodePlace(lat, lng);
  res.json({ place, lat, lng });
});

export default router;
