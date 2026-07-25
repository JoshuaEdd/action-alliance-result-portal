import express from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/local-governments', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT id, name FROM local_governments ORDER BY name`);
  res.json(rows);
});

router.get('/local-governments/:lgaId/wards', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, ward_number FROM wards WHERE local_government_id = $1 ORDER BY ward_number`,
    [req.params.lgaId]
  );
  res.json(rows);
});

router.get('/wards/:wardId/polling-units', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, pu_number FROM polling_units WHERE ward_id = $1 ORDER BY pu_number`,
    [req.params.wardId]
  );
  res.json(rows);
});

export default router;
