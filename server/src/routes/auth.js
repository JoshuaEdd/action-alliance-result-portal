import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { pool } from '../config/db.js';
import { generateOtp, hashOtp, verifyOtpHash, deliverOtp } from '../utils/otp.js';

const router = express.Router();

// FR-1.4 — rate-limited brute-force protection at the transport layer,
// on top of the per-account lockout counter below.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
const NG_PHONE = /^(\+234|0)[789][01]\d{8}$/;

// Agent self-registration — an invite code is the vetting step: it's
// issued by an admin for one specific polling unit, so registering
// doesn't let anyone claim just any PU (see SEC-10-adjacent reasoning
// in routes/admin.js's invite-codes routes).
router.post('/register', loginLimiter, async (req, res) => {
  const { inviteCode, fullName, identifier, password } = req.body;
  if (!inviteCode || !fullName || !identifier || !password) {
    return res.status(400).json({ error: 'inviteCode, fullName, identifier, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const isEmail = identifier.includes('@');
  if (!isEmail && !NG_PHONE.test(identifier)) {
    return res.status(400).json({ error: 'Enter a valid email or Nigerian phone number' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the code row for the duration of this transaction so two
    // simultaneous registrations can't both succeed with the same code.
    const { rows: codeRows } = await client.query(
      `SELECT * FROM invite_codes WHERE code = $1 FOR UPDATE`,
      [inviteCode.trim().toUpperCase()]
    );
    const invite = codeRows[0];

    if (!invite) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invite code not recognized' });
    }
    if (invite.used_by) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This invite code has already been used' });
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This invite code has expired' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (role, full_name, email, phone_number, password_hash, assigned_polling_unit_id, location_locked)
       VALUES ('agent', $1, $2, $3, $4, $5, TRUE)
       RETURNING id`,
      [
        fullName,
        isEmail ? identifier : null,
        isEmail ? null : identifier,
        passwordHash,
        invite.polling_unit_id,
      ]
    );
    const newUserId = userRows[0].id;

    await client.query(
      `UPDATE invite_codes SET used_by = $1, used_at = now() WHERE id = $2`,
      [newUserId, invite.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Account created — you can now sign in.' });
  } catch (err) {
    await client.query('ROLLBACK');
    // Duplicate email/phone, or the one-agent-per-PU race we guard against
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account already exists for that email/phone, or this polling unit already has an agent' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create account, please retry' });
  } finally {
    client.release();
  }
});

// STEP 1 — verify identifier + password, issue OTP (FR-1.1, FR-1.3)
router.post('/login/password', loginLimiter, async (req, res) => {
  const { identifier, password } = req.body; // identifier = email or phone
  if (!identifier || !password) {
    return res.status(400).json({ error: 'identifier and password are required' });
  }

  const { rows } = await pool.query(
    `SELECT * FROM users WHERE (email = $1 OR phone_number = $1) AND is_active = TRUE AND deleted_at IS NULL`,
    [identifier]
  );
  const user = rows[0];

  // Deliberately generic error — do not reveal whether the account exists
  const genericError = () => res.status(401).json({ error: 'Invalid credentials' });

  if (!user) return genericError();

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minsLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    return res.status(423).json({ error: `Account locked. Try again in ${minsLeft} minute(s).` });
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    const attempts = user.failed_login_attempts + 1;
    const lockUntil = attempts >= MAX_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60000)
      : null;
    await pool.query(
      `UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
      [attempts, lockUntil, user.id]
    );
    return genericError();
  }

  // Reset attempt counter on successful password check
  await pool.query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [user.id]
  );

  // FR-1.2 — 2FA on every login, not only at registration
  const code = generateOtp();
  const codeHash = await hashOtp(code);
  await pool.query(
    `INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at)
     VALUES ($1, $2, 'login', now() + ($3 || ' minutes')::interval)`,
    [user.id, codeHash, OTP_TTL_MINUTES]
  );
  await deliverOtp({
    destination: user.email || user.phone_number,
    code,
    channel: user.email ? 'email' : 'sms',
  });

  // Short-lived pre-auth token scoping the OTP step to this user only
  const preAuthToken = jwt.sign({ id: user.id, stage: 'otp_pending' }, process.env.JWT_SECRET, {
    expiresIn: '10m',
  });

  res.json({ preAuthToken, deliveredTo: user.email ? 'email' : 'phone' });
});

// STEP 2 — verify OTP, issue session JWT (FR-1.2)
router.post('/login/verify-otp', loginLimiter, async (req, res) => {
  const { preAuthToken, code } = req.body;
  if (!preAuthToken || !code) {
    return res.status(400).json({ error: 'preAuthToken and code are required' });
  }

  let payload;
  try {
    payload = jwt.verify(preAuthToken, process.env.JWT_SECRET);
    if (payload.stage !== 'otp_pending') throw new Error('wrong stage');
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }

  const { rows } = await pool.query(
    `SELECT * FROM otp_codes
     WHERE user_id = $1 AND purpose = 'login' AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [payload.id]
  );
  const otpRow = rows[0];
  if (!otpRow || new Date(otpRow.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Code expired, request a new one' });
  }

  const ok = await verifyOtpHash(code, otpRow.code_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect code' });

  await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otpRow.id]);

  const { rows: userRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [payload.id]);
  const user = userRows[0];

  // FR-3.1 — only pre-authorized administrator addresses may reach the admin portal;
  // that gate is enforced by rows only existing for authorized accounts.
  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
      assignedPollingUnitId: user.assigned_polling_unit_id,
      locationLocked: user.location_locked,
      scopeLocalGovernmentId: user.scope_local_government_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30m' } // FR-1.5 session timeout
  );

  res.json({
    token,
    user: {
      id: user.id,
      fullName: user.full_name,
      role: user.role,
      assignedPollingUnitId: user.assigned_polling_unit_id,
      locationLocked: user.location_locked,
      scopeLocalGovernmentId: user.scope_local_government_id,
    },
  });
});

export default router;
