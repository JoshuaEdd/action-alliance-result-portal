import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { pool } from '../config/db.js';
import { generateOtp, hashOtp, verifyOtpHash, deliverOtp } from '../utils/otp.js';

const router = express.Router();

// FR-1.4 — rate-limited brute-force protection at the transport layer.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── WebAuthn relying-party configuration ────────────────────────────
// On Render, RENDER_EXTERNAL_URL is injected automatically; locally the
// portal runs on http://localhost:4000. RP_ID must be the origin's
// registrable domain (no scheme/port).
const RP_NAME = process.env.RP_NAME || 'Action Alliance Result Portal';
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || '';
export const EXPECTED_ORIGIN =
  process.env.EXPECTED_ORIGIN || RENDER_EXTERNAL_URL || 'http://localhost:4000';
export const RP_ID = process.env.RP_ID || (RENDER_EXTERNAL_URL ? new URL(RENDER_EXTERNAL_URL).hostname : 'localhost');

function signChallenge(payload, expires_in) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: expires_in });
}

function verifySigned(token, stage) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.stage !== stage) throw new Error('wrong stage');
    return payload;
  } catch {
    return null;
  }
}

async function loadAgentByEmail(email) {
  const { rows } = await pool.query(
    `SELECT * FROM users
     WHERE email = $1 AND role = 'agent' AND is_active = TRUE AND deleted_at IS NULL`,
    [email]
  );
  return rows[0] || null;
}

// An "incomplete" agent account has no fingerprint credential yet — it can't
// sign in and is safe to resume: the person who controls the email is the
// only one who can ever finish enrolling it.
async function findIncompleteAgentByEmail(email) {
  const { rows } = await pool.query(
    `SELECT u.* FROM users u
     WHERE u.email = $1 AND u.role = 'agent' AND u.is_active = TRUE AND u.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.user_id = u.id)`,
    [email]
  );
  return rows[0] || null;
}

function mintEnrollmentToken(userId) {
  return signChallenge({ id: userId, stage: 'enroll' }, '10m');
}

// ─────────────────────────────────────────────────────────────────────
// AGENT REGISTRATION — no invite codes, no passwords.
// The agent picks their polling unit from the location cascade and links
// their account to their device fingerprint via a WebAuthn ceremony.
// One-agent-per-PU stays enforced by the DB's unique partial index.
// ─────────────────────────────────────────────────────────────────────

// STEP R1 — create the account shell (or RESUME an incomplete one), hand
// back an enrollment token. A failed fingerprint scan, expired session, or
// dropped connection after this point never locks the agent out: they can
// re-submit this same form and pick up where they left off.
router.post('/register', loginLimiter, async (req, res) => {
  const { fullName, email, pollingUnitId } = req.body;
  if (!fullName || !email || !pollingUnitId) {
    return res.status(400).json({ error: 'fullName, email, and pollingUnitId are required' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  const { rows: puRows } = await pool.query(`SELECT id FROM polling_units WHERE id = $1`, [pollingUnitId]);
  if (!puRows[0]) {
    return res.status(404).json({ error: 'Polling unit not recognized' });
  }

  // Retry path: the email belongs to an account whose fingerprint enrollment
  // never completed. Refresh its details and hand back a fresh token instead
  // of rejecting with "account exists".
  const incomplete = await findIncompleteAgentByEmail(normalizedEmail);
  if (incomplete) {
    try {
      await pool.query(
        `UPDATE users SET full_name = $1, assigned_polling_unit_id = $2, location_locked = TRUE WHERE id = $3`,
        [String(fullName).trim(), pollingUnitId, incomplete.id]
      );
      return res.status(200).json({
        enrollmentToken: mintEnrollmentToken(incomplete.id),
        resumed: true,
        message: 'Finishing fingerprint setup for your existing account.',
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'This polling unit already has an agent' });
      }
      console.error(err);
      return res.status(500).json({ error: 'Could not update account, please retry' });
    }
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (role, full_name, email, password_hash, assigned_polling_unit_id, location_locked)
       VALUES ('agent', $1, $2, NULL, $3, TRUE)
       RETURNING id`,
      [String(fullName).trim(), normalizedEmail, pollingUnitId]
    );
    // Short-lived token binding the WebAuthn ceremony to this fresh account
    res.status(201).json({
      enrollmentToken: mintEnrollmentToken(rows[0].id),
      message: 'Account created — scan your fingerprint to finish.',
    });
  } catch (err) {
    if (err.code === '23505') {
      const puTaken = /polling_unit/i.test(err.constraint || '');
      return res.status(409).json({
        error: puTaken
          ? 'This polling unit already has an agent'
          : 'This email is already registered — sign in with your fingerprint instead',
      });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create account, please retry' });
  }
});

// STEP R2 — WebAuthn creation options for the fingerprint enrollment.
// Accepts either a live enrollmentToken OR the agent's email: if the token
// expired mid-ceremony (10m TTL), the email alone re-mints one for an
// incomplete account, so a retry never forces starting over.
router.post('/webauthn/register/options', loginLimiter, async (req, res) => {
  const { enrollmentToken, email } = req.body;
  let enroll = enrollmentToken && verifySigned(enrollmentToken, 'enroll');

  if (!enroll && email) {
    // Expired/lost token — recover via email for credential-less accounts
    const incomplete = await findIncompleteAgentByEmail(String(email).trim().toLowerCase());
    if (incomplete) {
      enroll = { id: incomplete.id, stage: 'enroll' };
    }
  }
  if (!enroll) {
    return res.status(401).json({ error: 'Enrollment session expired — submit the form again to continue' });
  }

  const { rows } = await pool.query(
    `SELECT id, email, full_name FROM users WHERE id = $1 AND role = 'agent' AND is_active = TRUE`,
    [enroll.id]
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'Account not found' });

  // Re-enrolling the same device replaces its credential instead of failing
  const { rows: existing } = await pool.query(
    `SELECT id, transports FROM webauthn_credentials WHERE user_id = $1`,
    [user.id]
  );

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: isoUint8Array.fromUTF8String(user.id),
    userName: user.email,
    userDisplayName: user.full_name,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports || undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required', // the fingerprint IS the second factor here
    },
  });

  const challengeToken = signChallenge({ chal: options.challenge, uid: user.id, stage: 'chal-reg' }, '10m');
  // Always issue a fresh enrollment token alongside the options — if the
  // original one expired, this keeps the verify step (R3) self-sufficient.
  res.json({ options, challengeToken, enrollmentToken: mintEnrollmentToken(user.id) });
});

// STEP R3 — verify the attestation and store the credential's public key
router.post('/webauthn/register/verify', loginLimiter, async (req, res) => {
  const { enrollmentToken, challengeToken, response } = req.body;
  const enroll = enrollmentToken && verifySigned(enrollmentToken, 'enroll');
  const chal = challengeToken && verifySigned(challengeToken, 'chal-reg');
  if (!enroll || !chal || !response) {
    return res.status(401).json({ error: 'Enrollment session expired — please register again' });
  }
  if (chal.uid !== enroll.id) {
    return res.status(401).json({ error: 'Enrollment session mismatch — please register again' });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: chal.chal,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch (err) {
    console.error('Registration verification error:', err.message);
    return res.status(401).json({ error: 'Fingerprint enrollment could not be verified' });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(401).json({ error: 'Fingerprint enrollment failed' });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const transports = Array.isArray(response?.response?.transports) ? response.response.transports : null;

  await pool.query(
    `INSERT INTO webauthn_credentials (id, user_id, public_key, counter, device_type, backed_up, transports)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       public_key = EXCLUDED.public_key,
       counter = EXCLUDED.counter,
       device_type = EXCLUDED.device_type,
       backed_up = EXCLUDED.backed_up,
       transports = EXCLUDED.transports`,
    [
      credential.id,
      enroll.id,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      credentialDeviceType,
      credentialBackedUp,
      transports,
    ]
  );

  res.json({ verified: true, message: 'Fingerprint linked — you can now sign in.' });
});

// ─────────────────────────────────────────────────────────────────────
// AGENT LOGIN — email + fingerprint only. No passwords, no OTP.
// ─────────────────────────────────────────────────────────────────────

// STEP L1 — look up the account, request an assertion from its credentials
router.post('/webauthn/login/options', loginLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email is required' });

  const user = await loadAgentByEmail(email);
  if (!user) {
    return res.status(404).json({ error: 'No fingerprint account found for this email' });
  }

  const { rows: creds } = await pool.query(
    `SELECT id, transports FROM webauthn_credentials WHERE user_id = $1`,
    [user.id]
  );
  if (!creds.length) {
    return res.status(404).json({ error: 'This account has no fingerprint enrolled yet' });
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports || undefined,
    })),
  });

  const challengeToken = signChallenge({ chal: options.challenge, uid: user.id, stage: 'chal-auth' }, '5m');
  res.json({ options, challengeToken });
});

// STEP L2 — verify the signed assertion, issue the session JWT
router.post('/webauthn/login/verify', loginLimiter, async (req, res) => {
  const { email, challengeToken, response } = req.body;
  const chal = challengeToken && verifySigned(challengeToken, 'chal-auth');
  if (!chal || !response) {
    return res.status(401).json({ error: 'Sign-in session expired — please try again' });
  }

  const user = await loadAgentByEmail(String(email || '').trim().toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minsLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    return res.status(423).json({ error: `Account locked. Try again in ${minsLeft} minute(s).` });
  }

  // The asserted credential must belong to THIS user — never another account's
  const { rows: credRows } = await pool.query(
    `SELECT * FROM webauthn_credentials WHERE id = $1 AND user_id = $2`,
    [response.id, user.id]
  );
  const cred = credRows[0];
  if (!cred) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: chal.chal,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true, // fingerprint must have been presented
      credential: {
        id: cred.id,
        publicKey: isoBase64URL.toBuffer(cred.public_key),
        counter: Number(cred.counter),
      },
    });
  } catch (err) {
    console.error('Authentication verification error:', err.message);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!verification.verified) {
    // Same lockout ladder as the admin password path (FR-1.4)
    const attempts = user.failed_login_attempts + 1;
    const lockUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null;
    await pool.query(`UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`, [
      attempts,
      lockUntil,
      user.id,
    ]);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Counter regression means a cloned authenticator — hard reject
  if (verification.authenticationInfo.newCounter < Number(cred.counter)) {
    console.error(`Counter regression on credential ${cred.id} — possible clone`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  await pool.query(
    `UPDATE webauthn_credentials SET counter = $1, last_used_at = now() WHERE id = $2`,
    [verification.authenticationInfo.newCounter, cred.id]
  );
  await pool.query(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`, [user.id]);

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

// ─────────────────────────────────────────────────────────────────────
// ADMIN LOGIN — password + OTP, unchanged. Agents are locked out of this
// path: accounts without a password hash can't even attempt it, and any
// legacy agent whose hash still verifies gets bounced to the fingerprint
// flow (biometrics-only policy).
// ─────────────────────────────────────────────────────────────────────

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

  // Agents created through the biometric flow have no password at all
  if (!user.password_hash) return genericError();

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

  // Biometrics-only policy for agents — even legacy password accounts
  if (user.role === 'agent') {
    return res.status(403).json({ error: 'Agents sign in with fingerprint biometrics — use the Agent tab.' });
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
