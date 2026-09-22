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
import { requireAuth } from '../middleware/auth.js';
import {
  isAgentPortalActive,
  requireAgentPortalActive,
  PORTAL_INACTIVE_MESSAGE,
} from '../middleware/portal.js';

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
const NG_PHONE_RE = /^(\+234|0)[789][01]\d{8}$/;

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
  // Returns the row regardless of activation so the caller can differentiate
  // "under review", "rejected", and "deactivated" with specific errors instead
  // of a generic 404.
  const { rows } = await pool.query(
    `SELECT * FROM users
     WHERE email = $1 AND role = 'agent' AND deleted_at IS NULL`,
    [email]
  );
  return rows[0] || null;
}

// An "incomplete" agent account has no fingerprint credential yet — it can't
// sign in and is safe to resume: the person who controls the email is the
// only one who can ever finish enrolling it. Excludes rejected registrations
// (those must not be silently revived).
async function findIncompleteAgentByEmail(email) {
  const { rows } = await pool.query(
    `SELECT u.* FROM users u
     WHERE u.email = $1 AND u.role = 'agent' AND u.deleted_at IS NULL
       AND u.registration_status <> 'rejected'
       AND NOT EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.user_id = u.id)`,
    [email]
  );
  return rows[0] || null;
}

function hasFingerprint(userId) {
  return pool
    .query(`SELECT 1 FROM webauthn_credentials WHERE user_id = $1 LIMIT 1`, [userId])
    .then(({ rows }) => rows.length > 0);
}

function mintEnrollmentToken(userId) {
  return signChallenge({ id: userId, stage: 'enroll' }, '10m');
}

// Hides almost everything about the destination while keeping it recognizable:
// "ab***@gmail.com" or "+234****4321".
function maskEmail(email) {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at <= 1) return email;
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(name.length - 2, 0))}@${domain}`;
}
function maskPhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return `${'*'.repeat(Math.max(1, digits.length - 2))}${digits.slice(-2)}`;
  return `${phone.slice(0, Math.min(3, phone.length - 4))}****${digits.slice(-4)}`;
}

// Generates + stores + delivers a registration-verification OTP, then hands the
// client a short-lived token scoping the verify step to this user only.
async function sendRegistrationOtp({ res, userId, channel, email, phone, extra = {} }) {
  const destination = channel === 'sms' ? phone : email;
  if (!destination) {
    return res.status(400).json({
      error: channel === 'sms' ? 'No phone number available for SMS verification' : 'No email address available for verification',
    });
  }
  const code = generateOtp();
  const codeHash = await hashOtp(code);
  await pool.query(
    `INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at)
     VALUES ($1, $2, 'registration_verify', now() + ($3 || ' minutes')::interval)`,
    [userId, codeHash, OTP_TTL_MINUTES]
  );
  await deliverOtp({ destination, code, channel });
  const preVerifyToken = signChallenge({ id: userId, stage: 'reg_verify' }, '15m');
  return res.status(200).json({
    requiresVerification: true,
    preVerifyToken,
    channel,
    destinationMasked: channel === 'sms' ? maskPhone(phone) : maskEmail(email),
    ...extra,
  });
}

// Null when the agent is cleared to sign in, otherwise the HTTP status +
// message that explains *why* they are blocked.
function agentLoginBlock(user, { portalActive }) {
  if (!portalActive) return { status: 423, message: PORTAL_INACTIVE_MESSAGE };
  if (user.registration_status === 'pending') {
    return {
      status: 423,
      message: 'Your registration is under review by an administrator. You can sign in once it is approved.',
    };
  }
  if (user.registration_status === 'rejected') {
    return { status: 403, message: 'This registration was not approved. Contact an administrator.' };
  }
  if (!user.is_active) {
    return { status: 403, message: 'This account has been deactivated.' };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// AGENT REGISTRATION — no invite codes, no passwords.
// The agent picks their polling unit from the location cascade, chooses an
// Email or SMS verification method, validates a code sent to that address,
// then links their device fingerprint via a WebAuthn ceremony. New accounts
// start active ('accepted') once identity is verified — there is no manual
// admin acceptance queue; 'pending' only exists for legacy registrations.
// ─────────────────────────────────────────────────────────────────────

// STEP R1 — validate identity + location, create the account shell (never a
// duplicate), and send a verification code to the chosen Email/SMS channel.
// Also RESUME an incomplete registration whose code was already validated.
router.post('/register', loginLimiter, async (req, res) => {
  const { fullName, email, phoneNumber, pollingUnitId, verificationMethod } = req.body;
  if (!fullName || !email || !pollingUnitId || !verificationMethod) {
    return res
      .status(400)
      .json({ error: 'fullName, email, pollingUnitId, and verificationMethod are required' });
  }
  if (!['email', 'sms'].includes(verificationMethod)) {
    return res.status(400).json({ error: 'verificationMethod must be "email" or "sms"' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  // A phone is always captured when available (it is part of the agent's
  // registration identity for later submissions) but is REQUIRED for SMS.
  const phone = phoneNumber ? String(phoneNumber).trim() : null;
  if (verificationMethod === 'sms' && !NG_PHONE_RE.test(phone || '')) {
    return res.status(400).json({ error: 'Enter a valid Nigerian phone number for SMS verification' });
  }

  const { rows: puRows } = await pool.query(`SELECT id FROM polling_units WHERE id = $1`, [pollingUnitId]);
  if (!puRows[0]) {
    return res.status(404).json({ error: 'Polling unit not recognized' });
  }

  // Duplicate check (req: prevent duplicate email AND duplicate polling unit).
  // The one-agent-per-PU partial unique index below is the authoritative guard
  // against concurrent registrations racing for the same unit.
  const { rows: existingRows } = await pool.query(
    `SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [normalizedEmail]
  );
  const existing = existingRows[0];

  if (existing) {
    if (existing.role !== 'agent') {
      return res.status(409).json({ error: 'This email address is already used by another account' });
    }
    if (existing.registration_status === 'rejected') {
      return res.status(403).json({ error: 'This registration was not approved. Contact an administrator.' });
    }
    const enrolled = await hasFingerprint(existing.id);
    if (enrolled) {
      // A completed account — an actual duplicate registration attempt.
      return res.status(409).json({
        error:
          existing.registration_status === 'pending'
            ? 'This email is already registered and its application is pending review.'
            : 'This email is already registered — sign in with your fingerprint instead.',
      });
    }

    // Incomplete account (never finished fingerprinting) — resume it.
    try {
      await pool.query(
        `UPDATE users SET full_name = $1, phone_number = COALESCE($2, phone_number),
                assigned_polling_unit_id = $3, location_locked = TRUE
         WHERE id = $4`,
        [String(fullName).trim(), phone, pollingUnitId, existing.id]
      );
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          error: /polling_unit|one_agent_per_polling_unit/i.test(err.constraint || '')
            ? 'This polling unit already has an agent'
            : 'This phone number is already registered to another account',
        });
      }
      console.error(err);
      return res.status(500).json({ error: 'Could not update account, please retry' });
    }

    // Original registration already completed validation — skip straight to
    // the fingerprint ceremony (which itself requires the verified flag).
    if (existing.registration_verified_at) {
      return res.status(200).json({
        enrollmentToken: mintEnrollmentToken(existing.id),
        verified: true,
        resumed: true,
        message: 'Identity verified previously — finish with your fingerprint.',
      });
    }
    return sendRegistrationOtp({
      res,
      userId: existing.id,
      channel: verificationMethod,
      email: normalizedEmail,
      phone,
      extra: { resumed: true },
    });
  }

  let userId;
  try {
// New agents are accepted once their identity (email/SMS) is verified —
      // there is no manual admin acceptance queue, so the account starts
      // active and the fingerprint ceremony below completes sign-in.
      const { rows } = await pool.query(
        `INSERT INTO users (role, full_name, email, phone_number, password_hash,
                            assigned_polling_unit_id, location_locked, registration_status)
         VALUES ('agent', $1, $2, $3, NULL, $4, TRUE, 'accepted')
         RETURNING id`,
      [String(fullName).trim(), normalizedEmail, phone, pollingUnitId]
    );
    userId = rows[0].id;
  } catch (err) {
    if (err.code === '23505') {
      const constraint = err.constraint || '';
      if (/polling_unit|one_agent_per_polling_unit/i.test(constraint)) {
        return res.status(409).json({ error: 'This polling unit already has an agent' });
      }
      if (/phone/i.test(constraint)) {
        return res.status(409).json({ error: 'This phone number is already registered to another account' });
      }
      return res.status(409).json({
        error: 'This email is already registered — sign in with your fingerprint instead',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Could not create account, please retry' });
  }

  // New registration — send its first verification code.
  return sendRegistrationOtp({
    res,
    userId,
    channel: verificationMethod,
    email: normalizedEmail,
    phone,
  });
});

// STEP R1b — resend the registration verification code (handles expired /
// lost codes without re-creating the identity or a duplicate OTP record).
router.post('/register/resend-code', loginLimiter, async (req, res) => {
  const { email, verificationMethod } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (!['email', 'sms'].includes(verificationMethod)) {
    return res.status(400).json({ error: 'verificationMethod must be "email" or "sms"' });
  }

  const incomplete = await findIncompleteAgentByEmail(normalizedEmail);
  if (!incomplete) {
    return res.status(404).json({ error: 'No pending registration found for this email. Please register again.' });
  }
  if (incomplete.registration_verified_at) {
    return res.status(409).json({ error: 'This registration is already verified — continue to fingerprint setup.' });
  }
  return sendRegistrationOtp({
    res,
    userId: incomplete.id,
    channel: verificationMethod,
    email: normalizedEmail,
    phone: incomplete.phone_number,
    extra: { resumed: true },
  });
});

// STEP R1c — validate the code. Only after a successful validation is the
// fingerprint ceremony ever offered; a fresh enrollment token is minted here.
router.post('/register/verify-code', loginLimiter, async (req, res) => {
  const { preVerifyToken, code } = req.body;
  if (!preVerifyToken || !code) {
    return res.status(400).json({ error: 'preVerifyToken and code are required' });
  }

  const payload = verifySigned(preVerifyToken, 'reg_verify');
  if (!payload) {
    return res.status(401).json({ error: 'Verification session expired — request a new code' });
  }

  const { rows } = await pool.query(
    `SELECT * FROM otp_codes
     WHERE user_id = $1 AND purpose = 'registration_verify' AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [payload.id]
  );
  const otpRow = rows[0];
  if (!otpRow || new Date(otpRow.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Code expired, request a new one' });
  }

  const ok = await verifyOtpHash(String(code), otpRow.code_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect code' });

  await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otpRow.id]);
  await pool.query(`UPDATE users SET registration_verified_at = now() WHERE id = $1`, [payload.id]);

  res.json({ verified: true, enrollmentToken: mintEnrollmentToken(payload.id) });
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
    `SELECT id, email, full_name, registration_verified_at, registration_status FROM users
     WHERE id = $1 AND role = 'agent'`,
    [enroll.id]
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'Account not found' });
  if (user.registration_status === 'rejected') {
    return res.status(403).json({ error: 'This registration was not approved. Contact an administrator.' });
  }
  // The verification code must be validated BEFORE the fingerprint ceremony —
  // the server refuses to even mint options for an unverified account.
  if (!user.registration_verified_at) {
    return res
      .status(403)
      .json({ error: 'Please verify your email or phone first — a verification code was sent to you.' });
  }

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

  // The verification-code gate holds here too — never persist a credential
  // for an account whose email/phone was not validated.
  const { rows: userRows } = await pool.query(
    `SELECT registration_verified_at, registration_status FROM users WHERE id = $1 AND role = 'agent'`,
    [enroll.id]
  );
  const enrollUser = userRows[0];
  if (!enrollUser) return res.status(404).json({ error: 'Account not found' });
  if (enrollUser.registration_status === 'rejected') {
    return res.status(403).json({ error: 'This registration was not approved. Contact an administrator.' });
  }
  if (!enrollUser.registration_verified_at) {
    return res.status(403).json({ error: 'Please verify your email or phone first — a verification code was sent to you.' });
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

  res.json({ verified: true, message: 'Fingerprint linked — your account is ready. Sign in from the Agent tab.' });
});

// ─────────────────────────────────────────────────────────────────────
// AGENT PORTAL STATE — public read so the agent UI can show "temporarily
// unavailable" without guessing; enforcement is server-side regardless.
// ─────────────────────────────────────────────────────────────────────
router.get('/portal-status', async (_req, res) => {
  res.json({ active: await isAgentPortalActive() });
});

// ─────────────────────────────────────────────────────────────────────
// AUTHENTICATED PROFILE — the agent's registration record (name, phone,
// email, assigned PU) is the single source of truth used by later workflow
// steps; the app never asks for this information again (req: do not re-ask).
// ─────────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, email, phone_number, role, assigned_polling_unit_id,
            location_locked, registration_status, scope_local_government_id
     FROM users WHERE id = $1`,
    [req.user.id]
  );
  const u = rows[0];
  if (!u) return res.status(404).json({ error: 'Account not found' });
  res.json({
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    phoneNumber: u.phone_number,
    role: u.role,
    assignedPollingUnitId: u.assigned_polling_unit_id,
    locationLocked: u.location_locked,
    registrationStatus: u.registration_status,
    scopeLocalGovernmentId: u.scope_local_government_id,
  });
});

// ─────────────────────────────────────────────────────────────────────
// AGENT LOGIN — email + fingerprint only. No passwords, no OTP.
// ─────────────────────────────────────────────────────────────────────

// STEP L1 — look up the account, request an assertion from its credentials
router.post('/webauthn/login/options', loginLimiter, requireAgentPortalActive, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email is required' });

  const user = await loadAgentByEmail(email);
  if (!user) {
    return res.status(404).json({ error: 'No fingerprint account found for this email' });
  }

  // Pending / rejected / deactivated accounts and a globally-deactivated
  // portal all get a specific, honest reason (server-enforced, not just UI).
  const blocked = agentLoginBlock(user, { portalActive: await isAgentPortalActive() });
  if (blocked) return res.status(blocked.status).json({ error: blocked.message });

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

  // Re-check here as well — the portal could be deactivated or the admin
  // review decided between the options call (L1) and the fingerprint being
  // presented at verify (L2).
  const blocked = agentLoginBlock(user, { portalActive: await isAgentPortalActive() });
  if (blocked) return res.status(blocked.status).json({ error: blocked.message });

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
