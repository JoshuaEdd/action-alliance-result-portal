import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Source list gives LGA / Ward / Polling Unit *names* only — no official
// ward or PU codes. We generate stable, ordered numbers (matching the
// order they appear in the source document) so the schema's uniqueness
// constraints have something to key on. Swap these for INEC codes if/when
// they become available — the (ward_id, pu_number) and (lga_id, ward_number)
// constraints don't care what the values are, only that they're unique.
function pad(n, width) {
  return String(n).padStart(width, '0');
}

async function seed() {
  const raw = fs.readFileSync(path.join(__dirname, 'data/ahiazu-constituency.json'), 'utf8');
  const { localGovernments } = JSON.parse(raw);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lgaIds = new Map(); // name -> id
    const lgaWardCounters = new Map(); // lga name -> next ward number

    let wardCount = 0;
    let puCount = 0;

    for (const row of localGovernments) {
      // Local government (idempotent — safe to re-run)
      let lgaId = lgaIds.get(row.lga);
      if (!lgaId) {
        const { rows } = await client.query(
          `INSERT INTO local_governments (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [row.lga]
        );
        lgaId = rows[0].id;
        lgaIds.set(row.lga, lgaId);
        lgaWardCounters.set(row.lga, 1);
      }

      const wardNumber = pad(lgaWardCounters.get(row.lga), 2);
      lgaWardCounters.set(row.lga, lgaWardCounters.get(row.lga) + 1);

      const { rows: wardRows } = await client.query(
        `INSERT INTO wards (local_government_id, name, ward_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (local_government_id, ward_number) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [lgaId, row.ward, wardNumber]
      );
      const wardId = wardRows[0].id;
      wardCount++;

      for (let i = 0; i < row.polling_units.length; i++) {
        const puNumber = pad(i + 1, 3);
        await client.query(
          `INSERT INTO polling_units (ward_id, name, pu_number)
           VALUES ($1, $2, $3)
           ON CONFLICT (ward_id, pu_number) DO UPDATE SET name = EXCLUDED.name`,
          [wardId, row.polling_units[i], puNumber]
        );
        puCount++;
      }
    }

    await client.query('COMMIT');
    console.log(`Seeded ${lgaIds.size} local government(s), ${wardCount} ward(s), ${puCount} polling unit(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
