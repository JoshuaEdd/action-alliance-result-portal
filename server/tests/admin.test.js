import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import 'express-async-errors';
import express from 'express';
import jwt from 'jsonwebtoken';
import router from '../src/routes/admin.js';
import { pool } from '../src/config/db.js';

test('admin photo API preserves protected storage retrieval', async (t) => {
  const originalQuery = pool.query;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-ephemeral-signing-key';
  t.after(() => {
    pool.query = originalQuery;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'admin-photo-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('stored image bytes');
  const legacyPath = path.join(directory, 'legacy.png');
  await writeFile(legacyPath, bytes);
  let storedPhoto;
  let detailRow;
  const queries = [];
  pool.query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM polling_units pu')) return { rows: detailRow ? [detailRow] : [] };
    if (sql.includes('FROM submission_photos')) return { rows: storedPhoto ? [storedPhoto] : [] };
    return { rows: [] };
  };
  const app = express();
  app.use('/api/admin', router);
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/admin/photos/photo-1`;
  const headers = (role) => ({ Authorization: `Bearer ${jwt.sign({ id: 'test-admin', role }, process.env.JWT_SECRET)}` });

  await t.test('rejects anonymous and agent requests before querying photos', async () => {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: headers('agent') })).status, 403);
    assert.equal(queries.length, 0);
  });
  await t.test('all existing admin roles can retrieve database bytes with private caching and audit', async () => {
    storedPhoto = { data: bytes, mime_type: 'image/png' };
    for (const role of ['limited_admin', 'verifying_admin', 'chief_admin']) {
      const response = await fetch(url, { headers: headers(role) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    assert.ok(queries.some(({ sql, params }) => sql.includes('INSERT INTO audit_log') && params[1] === 'view_photo'));
  });
  await t.test('retrieves legacy file bytes and returns 404 for missing records/files', async () => {
    storedPhoto = { storage_path: legacyPath, mime_type: 'image/png' };
    const response = await fetch(url, { headers: headers('chief_admin') });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    storedPhoto.storage_path = path.join(directory, 'missing.png');
    assert.equal((await fetch(url, { headers: headers('chief_admin') })).status, 404);
    storedPhoto = null;
    assert.equal((await fetch(url, { headers: headers('chief_admin') })).status, 404);
  });

  await t.test('polling-unit detail supplies parent IDs even without a submission', async () => {
    detailRow = { id: null, pu_name: 'Test PU', ward_id: 'ward-1', lga_id: 'lga-1' };
    const response = await fetch(url.replace('/photos/photo-1', '/polling-units/pu-1'), { headers: headers('chief_admin') });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.ward_id, 'ward-1');
    assert.equal(detail.lga_id, 'lga-1');
    assert.deepEqual(detail.photos, []);
    const query = queries.find(({ sql }) => sql.includes('FROM polling_units pu'));
    assert.match(query.sql, /w\.id AS ward_id/);
    assert.match(query.sql, /lg\.id AS lga_id/);
    assert.deepEqual(query.params, ['pu-1']);
  });

  await t.test('retired invite endpoints return 404 for every admin role without database writes', async () => {
    const start = queries.length;
    for (const role of ['limited_admin', 'verifying_admin', 'chief_admin']) {
      for (const [method, route] of [['POST', '/invite-codes'], ['POST', '/invite-codes/bulk'], ['GET', '/invite-codes'], ['DELETE', '/invite-codes/old-code']]) {
        const response = await fetch(url.replace('/photos/photo-1', route), { method, headers: headers(role) });
        assert.equal(response.status, 404, `${role}: ${method} ${route}`);
      }
    }
    assert.equal(queries.length, start);
  });
});
