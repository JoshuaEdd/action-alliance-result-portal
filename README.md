# Election Result Upload Portal — Action Alliance

Internal record-keeping tool for polling-unit agents and administrators.
Not voter-facing; no voting or registration functionality (see SRS §1, §7).

This pass builds both portals end-to-end: the **Agent Submission Portal**
(auth → multi-step wizard → offline-tolerant submit) and the
**Administrator Portal** (dashboard → drill-down → correction workflow →
admin management), plus the backend both depend on.

## Structure

```
election-portal/
├── server/        Node/Express + PostgreSQL API
├── client/        React (Vite) — agent-facing wizard, port 5173
└── admin-client/  React (Vite) — admin dashboard, port 5174
```

## Getting it running

### 1. Database

```bash
createdb election_portal
cd server
cp .env.example .env        # edit DATABASE_URL / JWT_SECRET
npm install
npm run migrate             # applies src/db/schema.sql
npm run seed                # loads Ahiazu Ezinihitte Federal Constituency data
npm run create-admin -- "Your Name" you@example.com aTemporaryPassword
```

`npm run seed` loads real data for **Ahiazu Ezinihitte Federal
Constituency**: 2 local governments, 24 wards, 265 polling units
(`server/src/db/data/ahiazu-constituency.json`). The source list gives PU
and ward *names* only, no official codes, so `seed.js` generates ordered
`ward_number` / `pu_number` values (e.g. ward `01`, PU `001`) matching the
order they appear in the source document — swap in real INEC codes later
if they become available; the uniqueness constraints don't care what the
values are, only that they're unique. The script is idempotent — safe to
re-run.

`npm run create-admin` creates the first `chief_admin` account so you can
actually sign into the admin portal (its own account-creation UI requires
being logged in as a Chief Admin already, so the very first one has to be
bootstrapped this way).

**Getting agents onto the system** now goes through self-registration with
an invite code, not manual DB inserts:
1. As an admin, open a polling unit that has no agent yet
   (`/polling-unit/:id` in the admin app) and click **Generate code** under
   "Agent invite codes."
2. Give that code to the real agent for that PU.
3. The agent visits the agent app's `/register` page, enters the code
   along with their name/contact/password — this creates their account
   *and* permanently assigns + locks them to that polling unit
   (`server/src/routes/auth.js`'s `/register` route).

A code is single-use and tied to one specific polling unit, so registering
doesn't let someone claim just any PU — that's the whole point of routing
account creation through admin-issued codes rather than leaving it open.
A PU that already has an agent can't have a new code generated for it
(enforced both in the API and via a DB-level unique index, so a race
between two codes for the same PU can't both succeed).

### 2. API

```bash
npm run dev      # http://localhost:4000
```

### 3. Client (agent app)

```bash
cd ../client
npm install
npm run dev       # http://localhost:5173
```

### 4. Admin client

```bash
cd ../admin-client
npm install
npm run dev       # http://localhost:5174
```

Sign in with the Chief Admin account created above.

## What's implemented vs. the SRS

| Section | Status |
|---|---|
| §3.1 Authentication (FR-1.1–1.5) | Done — password + 2FA OTP, lockout, session timeout, plus invite-code self-registration for agents (vets which polling unit they can claim) |
| §3.2 Submission wizard (FR-2.1–2.14) | Done — 5-step wizard, live-camera-only capture, GPS+timestamp, offline queue via IndexedDB, local draft autosave |
| §4 Admin portal (FR-3, FR-4) | Done — dashboard summary, LGA/ward/PU drill-down with breadcrumbs, quick search, CSV + PDF export, near-real-time polling refresh (15s) |
| §5 Non-functional | Mobile-first layout on the agent app addresses NFR-1; offline queueing on the agent side |
| §6.1 Input integrity (SEC-1, SEC-2) | Done server-side (Zod + DB CHECK constraints), independent of client validation |
| §6.1 Immutability (SEC-3) | Done — no update/delete route exists; `correction_requests`/`correction_approvals` tables back a real approval workflow, exposed via `/admin/correction-requests` and the Corrections page |
| §6.1 Duplicate detection (SEC-5) | Done — partial unique index on `polling_unit_id`; a second submission returns 409 rather than overwriting |
| §6.2 Facial match (SEC-6) | Explicitly deferred per the SRS note ("ignore for now") |
| §6.2 GPS geofence (SEC-7) | Done — flags rather than rejects, via `isOutsideRadius`, surfaced as a badge in the admin UI |
| §6.3 File upload handling (SEC-8, SEC-9) | Type/size validated via multer; non-executable storage dir; `scanFile` is a placeholder — wire to ClamAV or a cloud AV API before production |
| §6.4 Audit log (SEC-11) | Done — every admin GET/POST/PATCH under `/api/admin` is logged via the `audit()` middleware wrapper |
| §6.4/6.5 Permission matrix (SEC-10) | Done — role checks (`limited_admin` / `verifying_admin` / `chief_admin`) gate corrections decisions and admin-account management; optional per-LGA `scope_local_government_id` restricts a scoped admin's dashboard |
| §6.5 Transport/storage encryption (SEC-13, SEC-14) | TLS is a deployment concern (put this behind HTTPS); at-rest encryption depends on hosting choice (e.g. managed Postgres with encryption at rest) |

## Design notes

Palette and type are described in-line in `client/src/styles/tokens.css`
(shared by `admin-client`). The vote-count entry screen (`VoteCountsStep`)
is deliberately styled as a ledger/tally sheet — bordered rows, monospace
digits — to visually mirror the paper result sheet the agent is
simultaneously photographing. The admin app reuses the same palette in a
denser, desktop-oriented sidebar + table layout suited to review work.

## Next steps

1. ~~Seed real LGA/ward/PU data~~ — done (`npm run seed`, see above). Swap
   generated ward/PU numbers for official INEC codes if/when available.
2. Replace `deliverOtp` and `scanFile` placeholders with real providers (SMS/email, AV scanning).
3. Decide on a superseding-record strategy for *applying* an approved
   correction without mutating the original row (the workflow up to
   approval is built; applying the change is flagged as a TODO in
   `routes/admin.js`).
4. Add authenticated photo serving (currently `submission_photos.storage_path`
   is stored but not exposed over HTTP — intentional until access control
   for raw images is designed).
5. Decide on photo persistence for the agent app's offline queue across a
   full app/process kill — currently in-memory until the HTTP POST succeeds
   or IndexedDB enqueue happens.
6. Production hardening: HTTPS, secrets management, DB role with
   `REVOKE UPDATE, DELETE` on append-only tables (see bottom of `schema.sql`).
