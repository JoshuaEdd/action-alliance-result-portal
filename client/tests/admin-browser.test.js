import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Set PLAYWRIGHT_MODULE to an installed playwright (or @playwright/test)
// entry point to run these real-browser checks without adding app dependencies.
const browserModule = process.env.PLAYWRIGHT_MODULE;
const production = process.env.ADMIN_TEST_PRODUCTION === '1';
const origin = 'http://127.0.0.1:5189';
const photo = { id: 'photo-1', photo_type: 'agent_tag', captured_at: '2026-10-01T10:30:00Z' };
const submission = {
  id: 'submission-1', status: 'submitted', reference_number: 'TEST-RESULT-1',
  pu_name: 'Test polling unit', pu_number: '001', ward_name: 'Test ward', lga_name: 'Test LGA',
  ward_id: 'ward-1', lga_id: 'lga-1', capture_lat: 5.5, capture_lng: 7.2,
  capture_place: 'Test capture place', captured_at: photo.captured_at,
  photos: [photo, { ...photo, id: 'photo-2', photo_type: 'result_sheet' }, { ...photo, id: 'photo-3', photo_type: 'agent_passport' }],
  partyVotes: [],
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('admin browser regression checks', { skip: !browserModule }, async (t) => {
  const { chromium } = await import(pathToFileURL(browserModule).href);
  const webServer = spawn(process.execPath, production
    ? ['src/index.js']
    : ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5189', '--strictPort'], {
    cwd: fileURLToPath(new URL(production ? '../../server/' : '..', import.meta.url)),
    env: production ? { ...process.env, NODE_ENV: 'production', PORT: '5189' } : process.env,
    stdio: 'ignore',
  });
  t.after(() => webServer.kill());
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    if (attempt === 100) throw new Error('Test web server did not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const browser = await chromium.launch();
  t.after(() => browser.close());

  async function setup({ detail = submission, photoStatus = 200, photoBody = png, photoDelay = 0, width = 1280, role = 'chief_admin' } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(({ role }) => {
      sessionStorage.setItem('token', 'browser-test-session');
      sessionStorage.setItem('user', JSON.stringify({ role, fullName: 'Test administrator' }));
    }, { role });
    const page = await context.newPage();
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    const requests = [];
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      if (!new URL(request.url()).pathname.startsWith('/api/')) return route.continue();
      requests.push({ url: request.url(), authorization: request.headers().authorization, method: request.method() });
      const path = new URL(request.url()).pathname;
      if (path.includes('/admin/photos/')) {
        if (photoDelay) await new Promise((resolve) => setTimeout(resolve, photoDelay));
        return route.fulfill({ status: photoStatus, contentType: 'image/png', body: photoBody });
      }
      let body = [];
      if (path === '/api/admin/polling-units/pu-1') body = detail;
      if (path === '/api/admin/summary') body = { parties: [], totalPollingUnits: 1, reportingProgressPct: 100, polling_units_reported: 1 };
      if (path === '/api/admin/party-results') body = { parties: [] };
      if (path === '/api/admin/local-governments') body = [{ id: 'lga-1', name: 'Test LGA' }];
      if (path === '/api/admin/local-governments/lga-1/wards') body = [{ id: 'ward-1', name: 'Test ward', ward_number: '01' }];
      if (path === '/api/admin/wards/ward-1/polling-units') body = [{ id: 'pu-1', name: 'Test polling unit', pu_number: '001', status: 'submitted' }];
      if (path.includes('portal-status')) body = { active: true };
      await route.fulfill({ json: body });
    });
    return { context, page, requests, browserErrors };
  }

  await t.test('uploaded photos have visible previews and open an enlarged image without PDF export', async () => {
    const { context, page, requests } = await setup();
    try {
      const response = await page.goto(`${origin}/polling-unit/pu-1`);
      if (production) assert.match(response.headers()['content-security-policy'], /img-src[^;]*blob:/);
      const tiles = page.locator('.detail-photo-grid .ph');
      await tiles.first().waitFor({ state: 'attached' });
      await page.waitForFunction(() => document.querySelectorAll('.ph img').length === 3 && [...document.querySelectorAll('.ph img')].every((img) => img.complete && img.naturalWidth > 0));
      for (const tile of await tiles.all()) {
        const box = await tile.boundingBox();
        assert.ok(box.width > 50 && box.height > 50, `Photo preview collapsed: ${JSON.stringify(box)}`);
      }
      assert.ok(requests.filter((r) => r.url.includes('/admin/photos/')).every((r) => r.authorization === 'Bearer browser-test-session'));
      await tiles.first().click();
      await page.locator('.lightbox-img').waitFor({ state: 'visible' });
      assert.match(await page.locator('.lightbox-meta').innerText(), /TEST-RESULT-1/);
      assert.match(await page.locator('.lightbox-meta').innerText(), /Test capture place/);
      assert.match(await page.locator('.lightbox-meta').innerText(), /5.5, 7.2/);
      await page.keyboard.press('Escape');
      await page.locator('.lightbox-img').waitFor({ state: 'hidden' });
      assert.ok(!requests.some((r) => r.url.includes('/export/')));
    } finally { await context.close(); }
  });

  await t.test('photos show loading, missing, HTTP-error and corrupt-image states', async () => {
    for (const options of [
      { photoDelay: 1500, expected: 'Loading photo…' },
      { detail: { ...submission, photos: [] }, expected: 'not captured' },
      { photoStatus: 404, expected: 'Unable to load photo' },
      { photoStatus: 403, expected: 'Unable to load photo' },
      { photoBody: Buffer.from('not an image'), expected: 'Unable to load photo' },
    ]) {
      const { context, page } = await setup(options);
      try {
        await page.goto(`${origin}/polling-unit/pu-1`);
        await page.getByText(options.expected, { exact: false }).first().waitFor();
        assert.equal(await page.locator('.ph').first().isDisabled(), true);
      } finally { await context.close(); }
    }
  });

  await t.test('photo preview remains visible on mobile and tablet', async () => {
    for (const width of [390, 768]) {
      const { context, page } = await setup({ width });
      try {
        await page.goto(`${origin}/polling-unit/pu-1`);
        await page.waitForFunction(() => document.querySelectorAll('.ph:not(:disabled)').length === 3);
        const box = await page.locator('.ph').first().boundingBox();
        assert.ok(box.width > 0 && box.height > 0);
        await page.locator('.ph').first().click();
        await page.locator('.lightbox-img').waitFor({ state: 'visible' });
        await page.getByLabel('Close photo').click();
        await page.locator('.lightbox-img').waitFor({ state: 'hidden' });
      } finally { await context.close(); }
    }
  });

  await t.test('polling-unit breadcrumbs link to the real LGA and ward routes', async () => {
    const { context, page } = await setup();
    try {
      await page.goto(`${origin}/polling-unit/pu-1`);
      await page.locator('.breadcrumb').waitFor();
      assert.equal(await page.locator('.breadcrumb a', { hasText: 'Test LGA' }).getAttribute('href'), '/lga/lga-1');
      assert.equal(await page.locator('.breadcrumb a', { hasText: 'Test ward' }).getAttribute('href'), '/lga/lga-1/ward/ward-1');
    } finally { await context.close(); }
  });

  await t.test('breadcrumbs, Home, Back and browser history work by mouse and keyboard at each screen size', async () => {
    for (const width of [390, 768, 1280]) {
      const { context, page } = await setup({ width });
      try {
        await page.goto(`${origin}/polling-unit/pu-1`);
        const wardLink = page.locator('.breadcrumb a', { hasText: 'Test ward' });
        await wardLink.waitFor();
        const bounds = await wardLink.boundingBox();
        assert.ok(bounds.x >= 240 && bounds.x + bounds.width <= width, `Breadcrumb outside viewport at ${width}: ${JSON.stringify(bounds)}`);
        const current = page.locator('.breadcrumb [aria-current="page"]');
        assert.match(await current.innerText(), /Test polling unit/);
        assert.equal(await current.getAttribute('href'), null);
        // Detect accidental full-document navigation as well as route errors.
        await page.evaluate(() => { window.breadcrumbTestMarker = true; });
        await wardLink.focus();
        await page.keyboard.press('Enter');
        await page.waitForURL(`${origin}/lga/lga-1/ward/ward-1`);
        await page.getByRole('heading', { name: 'Test ward — Ward 01', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.breadcrumbTestMarker), true);
        await page.locator('.breadcrumb a', { hasText: 'Test LGA' }).click();
        await page.waitForURL(`${origin}/lga/lga-1`);
        await page.getByRole('heading', { name: 'Test LGA', exact: true }).waitFor();
        await page.getByLabel('Go back', { exact: true }).click();
        await page.waitForURL(`${origin}/lga/lga-1/ward/ward-1`);
        await page.goBack();
        await page.waitForURL(`${origin}/polling-unit/pu-1`);
        await page.goForward();
        await page.waitForURL(`${origin}/lga/lga-1/ward/ward-1`);
        await page.getByLabel('Go to home page').focus();
        await page.keyboard.press('Enter');
        await page.waitForURL(`${origin}/dashboard`);
        await page.goto(`${origin}/lga/lga-1`);
        await page.locator('.breadcrumb a', { hasText: 'Ahiazu Federal Constituency' }).click();
        await page.waitForURL(`${origin}/dashboard`);
      } finally { await context.close(); }
    }
  });

  await t.test('Back on a direct-entry detail page falls back to its parent', async () => {
    const { context, page } = await setup();
    try {
      await page.goto(`${origin}/polling-unit/pu-1`);
      await page.getByLabel('Go back', { exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(`${origin}/lga/lga-1/ward/ward-1`);
    } finally { await context.close(); }
  });

  await t.test('no admin role sees invite controls or makes invite API requests', async () => {
    for (const role of ['limited_admin', 'verifying_admin', 'chief_admin']) {
      const { context, page, requests } = await setup({ role, detail: { ...submission, id: null, status: null, photos: [], partyVotes: [] } });
      try {
        for (const path of ['/dashboard', '/lga/lga-1', '/lga/lga-1/ward/ward-1', '/polling-unit/pu-1']) {
          await page.goto(`${origin}${path}`);
          await page.locator('.breadcrumb').waitFor();
          if (path === '/polling-unit/pu-1') await page.getByText('No accepted result has been submitted', { exact: false }).waitFor();
          assert.equal(await page.getByRole('button', { name: /generate.*code/i }).count(), 0);
          assert.doesNotMatch(await page.locator('.main').innerText(), /invite codes|generate codes/i);
          if (path !== '/polling-unit/pu-1') assert.equal(await page.getByRole('button', { name: 'Export Excel (.xlsx)', exact: true }).count(), 1);
        }
        assert.equal(requests.filter((r) => r.url.includes('invite-codes')).length, 0);
      } finally { await context.close(); }
    }
  });
});
