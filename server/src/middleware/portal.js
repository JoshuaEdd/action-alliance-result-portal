import { pool } from '../config/db.js';

// Server-authoritative global agent-portal state (req: admin can deactivate
// every agent portal with one control). The value lives in app_settings so it
// survives restarts and cannot be flipped from the frontend — an agent hitting
// an API route directly is blocked right here, not just in the UI.
export async function isAgentPortalActive() {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'agent_portal_active'`);
  const value = rows[0]?.value;
  if (value && typeof value === 'object' && value !== null && typeof value.active === 'boolean') {
    return value.active;
  }
  // Missing row (pre-migration DB) defaults to active — never start locked.
  return true;
}

export async function setAgentPortalActive(active) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('agent_portal_active', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ active: !!active })]
  );
}

export const PORTAL_INACTIVE_MESSAGE =
  'Agent portal is temporarily unavailable. Please check back when uploads are enabled.';

// Middleware: rejects the request with 423 when the global agent portal is
// deactivated. Used on every agent-facing mutation (and agent sign-in) so the
// restriction cannot be bypassed through a direct API call.
export async function requireAgentPortalActive(req, res, next) {
  const active = await isAgentPortalActive();
  if (!active) {
    return res.status(423).json({ error: PORTAL_INACTIVE_MESSAGE, code: 'PORTAL_INACTIVE' });
  }
  next();
}