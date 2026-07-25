import { pool } from '../config/db.js';

export async function logAction({ adminId, action, targetTable, targetId, metadata }) {
  await pool.query(
    `INSERT INTO audit_log (admin_id, action, target_table, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminId, action, targetTable || null, targetId || null, metadata ? JSON.stringify(metadata) : null]
  );
}

// Express middleware wrapper: logs after a successful (2xx) response, so a
// failed request (e.g. 403/500) doesn't create a misleading audit entry.
export function audit(action, { targetTable } = {}) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        logAction({
          adminId: req.user.id,
          action,
          targetTable,
          targetId: req.params.id || req.params.pollingUnitId || null,
          metadata: { path: req.originalUrl, method: req.method },
        }).catch((err) => console.error('Audit log write failed:', err.message));
      }
    });
    next();
  };
}
