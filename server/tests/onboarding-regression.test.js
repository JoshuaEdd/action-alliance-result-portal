import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import 'express-async-errors';
import express from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../src/config/db.js';
import router from '../src/routes/auth.js';
import { hashOtp } from '../src/utils/otp.js';

test('existing agent onboarding remains independent of retired admin invite endpoints', async (t) => {
  const originalQuery = pool.query;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-ephemeral-signing-key';
  t.after(() => {
    pool.query = originalQuery;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });
  const agent = { id: 'agent-1', role: 'agent', registration_status: 'accepted', registration_verified_at: new Date() };
  let enrolled = false;
  let duplicateUnit = false;
  let verified = false;
  const codeHash = await hashOtp('123456');
  const queries = [];
  pool.query = async (sql, params) => {
    queries.push({ sql, params });
    assert.doesNotMatch(sql, /invite_codes/);
    if (sql.includes('FROM polling_units')) return { rows: [{ id: 'pu-1' }] };
    if (sql.includes('FROM users WHERE email')) return { rows: [agent] };
    if (sql.includes('SELECT 1 FROM webauthn_credentials')) return { rows: enrolled ? [{ id: 'credential-1' }] : [] };
    if (sql.includes('UPDATE users SET full_name') && duplicateUnit) throw Object.assign(new Error('duplicate assignment'), { code: '23505', constraint: 'one_agent_per_polling_unit' });
    if (sql.includes('FROM otp_codes')) return { rows: [{ id: 'otp-1', code_hash: codeHash, expires_at: new Date(Date.now() + 60000) }] };
    if (sql.includes('SELECT id, email, full_name, registration_verified_at')) return { rows: [{ ...agent, registration_verified_at: verified ? agent.registration_verified_at : null }] };
    return { rows: [] };
  };
  const app = express();
  app.use(express.json());
  app.use('/api/auth', router);
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const identity = { fullName: 'Test Agent', email: 'test-agent@example.invalid', pollingUnitId: 'pu-1', verificationMethod: 'email' };

  await t.test('resumes verified registration and locks its polling-unit assignment without an invite code', async () => {
    const response = await post('/register', identity);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.verified, true);
    assert.equal(jwt.verify(data.enrollmentToken, process.env.JWT_SECRET).stage, 'enroll');
    const assignment = queries.find(({ sql }) => sql.includes('UPDATE users SET full_name'));
    assert.match(assignment.sql, /location_locked = TRUE/);
    assert.equal(assignment.params[2], 'pu-1');
  });
  await t.test('still rejects completed duplicate registrations and conflicting polling-unit assignments', async () => {
    enrolled = true;
    assert.equal((await post('/register', identity)).status, 409);
    enrolled = false;
    duplicateUnit = true;
    assert.equal((await post('/register', identity)).status, 409);
    duplicateUnit = false;
  });
  await t.test('OTP rejects incorrect codes and unlocks enrollment only for a correct code', async () => {
    const preVerifyToken = jwt.sign({ id: agent.id, stage: 'reg_verify' }, process.env.JWT_SECRET);
    assert.equal((await post('/register/verify-code', { preVerifyToken, code: '000000' })).status, 401);
    const response = await post('/register/verify-code', { preVerifyToken, code: '123456' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).verified, true);
    assert.ok(queries.some(({ sql }) => sql.includes('UPDATE otp_codes SET consumed_at')));
  });
  await t.test('fingerprint enrollment still requires verified identity and valid enrollment tokens', async () => {
    assert.equal((await post('/webauthn/register/options', {})).status, 401);
    const enrollmentToken = jwt.sign({ id: agent.id, stage: 'enroll' }, process.env.JWT_SECRET);
    assert.equal((await post('/webauthn/register/options', { enrollmentToken })).status, 403);
    assert.equal((await post('/webauthn/register/verify', {})).status, 401);
  });
});
