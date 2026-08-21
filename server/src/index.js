import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createProxyMiddleware } from 'http-proxy-middleware';

import authRoutes from './routes/auth.js';
import locationRoutes from './routes/locations.js';
import submissionRoutes from './routes/submissions.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const clientDist = path.resolve(root, '..', 'client', 'dist');

const IS_PROD = process.env.NODE_ENV === 'production';
const hasClient = existsSync(path.join(clientDist, 'index.html'));

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
  })
);
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/admin', adminRoutes);

// ---- Frontends ----
// One server for everything: the API plus the single merged frontend (agent +
// admin, role-based). In production the built dist is served statically; in
// development (the default) the Vite dev server started by ../dev.js is
// proxied so HMR keeps working while everything stays on this one port.
// ---- Dev: proxy to Vite dev server ----
const agentProxy = createProxyMiddleware({ target: 'http://localhost:5173', changeOrigin: true });

const server = app.listen(process.env.PORT || 4000, () => {
  console.log(`Election portal listening on :${server.address().port}`);
  if (IS_PROD) {
    console.log(
      `  app: ${hasClient ? 'serving client/dist' : 'WARNING client/dist missing — run "npm --prefix client run build"'}`
    );
  } else {
    console.log('  dev mode: proxying / -> client (Vite :5173)');
  }
});

if (IS_PROD) {
  if (hasClient) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
} else {
  // Forward to the Vite dev server without touching the URL path. WebSocket
  // upgrade requests bypass Express middleware, so forward them explicitly.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) return next();
    return agentProxy(req, res, next);
  });
  server.on('upgrade', (req, socket, head) => {
    agentProxy.upgrade(req, socket, head);
  });
}

// Multer/validation/uncaught-async errors land here as JSON instead of killing
// the process. `express-async-errors` forwards rejected promises to this.
app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return; // a response was already underway — let it finish
  // A database failure is never a client's fault; return a clean generic 500
  // and keep the detailed cause in the server log rather than the response.
  const isDbError = err && (err.code === 'ECONNREFUSED' || /(postgres|pg_|syntax|2350|42P01|42703|28P01|3D000)/i.test(String(err.code) + ' ' + String(err.message)));
  const status = err.status || (isDbError ? 500 : 500);
  res.status(status).json({ error: err.status ? err.message : 'Unexpected server error' });
});
