// Root dev runner: starts the API server plus both frontends together,
// with labelled, interleaved output. No extra dependencies — just Node.
//
//   node dev.js
//
// Everything is served through ONE server on :4000:
//   http://localhost:4000/       — merged app (agent + admin, role-based)
//   http://localhost:4000/api    — API
// The Vite dev server on :5173 is internal (proxied by Express for HMR);
// use the :4000 URL.
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname);
const IS_WIN = process.platform === 'win32';

const APPS = [
  { name: 'server', label: 'server (:4000)', cwd: path.join(root, 'server') },
  { name: 'app   ', label: 'vite app (:5173, internal)', cwd: path.join(root, 'client') },
];

const kids = APPS.map((app) => {
  // Windows: spawn cmd.exe with a literal command string (shell:false), which
  // avoids both EINVAL (Node refuses .cmd files since CVE-2024-27980) and the
  // DEP0190 deprecation warning (shell:true + args). POSIX: plain npm.
  const command = IS_WIN ? 'cmd.exe' : 'npm';
  const args = IS_WIN ? ['/c', 'npm run dev'] : ['run', 'dev'];
  const child = spawn(command, args, {
    cwd: app.cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `[${app.label}]`;
  const fmt = (d) => String(d).split('\n').filter(Boolean).map((l) => `\x1b[90m${tag}\x1b[0m ${l}\n`).join('');
  child.stdout.on('data', (d) => process.stdout.write(fmt(d)));
  child.stderr.on('data', (d) => process.stderr.write(fmt(d)));
  child.on('exit', (code) => {
    console.error(`${tag} exited (code ${code}). Stopping the rest.`);
    shutdown();
  });
  return child;
});

function shutdown() {
  for (const child of kids) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Starting Action Alliance portal — press Ctrl+C to stop all.');
console.log('  App: http://localhost:4000/    API: http://localhost:4000/api');