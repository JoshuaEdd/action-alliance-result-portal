-- Election Result Upload Portal — schema
-- Maps directly to SRS sections 2 (roles), 3 (agent submission), 6 (security)
-- Re-runnable/idempotent: every object is created IF NOT EXISTS and enum
-- types/columns added later are guarded, so `npm run migrate` is safe to
-- re-apply to an existing database (it only applies what's missing).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- ─────────────────────────────────────────────
-- Political parties — every INEC-approved party on the result sheet.
-- Action Alliance is flagged is_priority so the UI can pin/highlight it
-- without hardcoding party names anywhere in application code.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS political_parties (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL UNIQUE,
  abbreviation  TEXT NOT NULL UNIQUE,
  is_priority   BOOLEAN NOT NULL DEFAULT FALSE,
  display_order SMALLINT NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────
-- Location hierarchy (Section 7: provided separately, loaded via seed)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS local_governments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS wards (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  local_government_id   UUID NOT NULL REFERENCES local_governments(id),
  name                  TEXT NOT NULL,
  ward_number           TEXT NOT NULL,
  UNIQUE (local_government_id, ward_number)
);

CREATE TABLE IF NOT EXISTS polling_units (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ward_id           UUID NOT NULL REFERENCES wards(id),
  name              TEXT NOT NULL,
  pu_number         TEXT NOT NULL,
  registered_lat    DOUBLE PRECISION,
  registered_lng    DOUBLE PRECISION,
  UNIQUE (ward_id, pu_number)
);

-- ─────────────────────────────────────────────
-- Users: agents + administrators (Section 2)
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('agent', 'limited_admin', 'verifying_admin', 'chief_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role                  user_role NOT NULL,
  full_name             TEXT NOT NULL,
  email                 TEXT UNIQUE,
  phone_number          TEXT UNIQUE,
  password_hash         TEXT NOT NULL,
  -- Agent-only: assigned PU is confirmed once then locked (FR-2.2)
  assigned_polling_unit_id UUID REFERENCES polling_units(id),
  location_locked       BOOLEAN NOT NULL DEFAULT FALSE,
  -- Admin-only: Chief Administrator can restrict a limited/verifying admin
  -- to a single LGA; NULL means no restriction (full federal-constituency view)
  scope_local_government_id UUID REFERENCES local_governments(id),
  -- Failed-login lockout (FR-1.4)
  failed_login_attempts SMALLINT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  -- Agent registration lifecycle. New accounts are 'accepted' once their
  -- identity is verified (no admin review queue — see /registrations notes);
  -- 'rejected' is kept for historically denied applications so they cannot
  -- be silently revived.
  registration_status   TEXT NOT NULL DEFAULT 'accepted',
  -- Set when the agent's email/SMS verification code is validated, the gate
  -- before fingerprint enrollment is ever offered.
  registration_verified_at TIMESTAMPTZ,
  -- Who/When an administrator reviewed this registration ('accepted'/'rejected')
  registration_decided_by UUID REFERENCES users(id),
  registration_decided_at TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ, -- soft-delete: remove from lists, never log in
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_or_phone CHECK (email IS NOT NULL OR phone_number IS NOT NULL)
);

-- `deleted_at` was added after the initial release; keep the migration safe
-- for databases that already had a `users` table without it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Registration review / verification columns for databases that predate the
-- admin-review workflow (guarded so `npm run migrate` stays idempotent).
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'accepted';
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_decided_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_decided_at TIMESTAMPTZ;

-- Agents authenticate with fingerprint biometrics (WebAuthn), not passwords —
-- password_hash stays NOT NULL only for legacy rows; new agent rows are NULL.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- ─────────────────────────────────────────────
-- WebAuthn credentials (agent fingerprint login)
-- Browsers never expose raw biometric data; instead the device's platform
-- authenticator (Touch ID / Windows Hello / Android fingerprint) signs a
-- server-issued challenge and we store the corresponding public key here.
-- One row per enrolled device per user.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            TEXT PRIMARY KEY, -- base64url credential ID from the authenticator
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,    -- base64url-encoded COSE public key
  counter       BIGINT NOT NULL DEFAULT 0,
  device_type   TEXT,
  backed_up     BOOLEAN NOT NULL DEFAULT FALSE,
  transports    TEXT[],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx ON webauthn_credentials (user_id);

-- One agent per polling unit — enforced at the DB level, not just in
-- application code, so a race between two simultaneous registrations
-- with different (still-valid) codes for the same PU can't both succeed.
CREATE UNIQUE INDEX IF NOT EXISTS one_agent_per_polling_unit
  ON users (assigned_polling_unit_id)
  WHERE assigned_polling_unit_id IS NOT NULL AND role = 'agent';

-- One-time tokens for 2FA on every login (FR-1.2, SEC-required on admin too)
CREATE TABLE IF NOT EXISTS otp_codes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id),
  code_hash     TEXT NOT NULL,
  purpose       TEXT NOT NULL DEFAULT 'login',
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- Submissions (Section 3.2 / 6.1)
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE submission_status AS ENUM ('submitted', 'under_review', 'flagged', 'correction_pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS submissions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference_number      TEXT NOT NULL UNIQUE,
  polling_unit_id       UUID NOT NULL REFERENCES polling_units(id),
  agent_id              UUID NOT NULL REFERENCES users(id),

  -- FR-2.3 vote counts
  total_registered_voters   INTEGER NOT NULL CHECK (total_registered_voters >= 0),
  total_accredited_voters   INTEGER NOT NULL CHECK (total_accredited_voters >= 0),
  total_valid_votes         INTEGER NOT NULL CHECK (total_valid_votes >= 0),
  total_invalid_votes       INTEGER NOT NULL CHECK (total_invalid_votes >= 0),
  total_votes               INTEGER NOT NULL CHECK (total_votes >= 0),

  -- FR-2.5 agent details captured at submission time (may differ from account holder)
  submitting_agent_name     TEXT NOT NULL,
  submitting_agent_phone    TEXT NOT NULL,

  -- FR-2.7 capture-time geolocation
  capture_lat           DOUBLE PRECISION NOT NULL,
  capture_lng           DOUBLE PRECISION NOT NULL,
  captured_at           TIMESTAMPTZ NOT NULL,
  -- Human-readable place at the capture point (reverse-geocoded server-side
  -- at submission time) so admins can read street / landmark / town without
  -- opening a map. NULL only if the geocoder is unreachable.
  capture_place         TEXT,
  gps_flagged           BOOLEAN NOT NULL DEFAULT FALSE, -- SEC-7

  status                submission_status NOT NULL DEFAULT 'submitted',
  duplicate_of          UUID REFERENCES submissions(id), -- SEC-5

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- SEC-2: server-side arithmetic integrity, enforced in addition to app-layer checks
  CONSTRAINT vote_sum_matches CHECK (total_votes = total_valid_votes + total_invalid_votes),
  CONSTRAINT accredited_le_registered CHECK (total_accredited_voters <= total_registered_voters),
  CONSTRAINT votes_le_accredited CHECK (total_votes <= total_accredited_voters)
);

-- SEC-5: one accepted (non-duplicate) submission per polling unit
CREATE UNIQUE INDEX IF NOT EXISTS one_accepted_submission_per_pu
  ON submissions (polling_unit_id)
  WHERE duplicate_of IS NULL AND status != 'flagged';

-- Migration: the reverse-geocoded capture point was added after some prod
-- DBs were created, and CREATE TABLE IF NOT EXISTS will not backfill an
-- existing table. Idempotent for DBs that already have the column.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS capture_place TEXT;

CREATE TABLE IF NOT EXISTS submission_photos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id   UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  photo_type      TEXT NOT NULL CHECK (photo_type IN ('agent_tag', 'result_sheet', 'agent_passport')),
  storage_path    TEXT NOT NULL, -- non-executable, access-restricted location (SEC-9)
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, photo_type)
);

-- Migration: per-photo capture time as stamped by the agent's shutter
-- (differs from created_at, which is when the server received the file —
-- potentially hours later via the offline queue). Idempotent for DBs that
-- already have the column from a fresh schema run.
ALTER TABLE submission_photos ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;

-- Migration: photo bytes now live IN the database (data BYTEA). Render's
-- ephemeral disk wiped ./uploads on every deploy/restart, so uploaded
-- evidence vanished while its database row survived. New uploads keep
-- storage_path NULL; pre-migration rows fall back to their legacy file.
ALTER TABLE submission_photos ADD COLUMN IF NOT EXISTS data BYTEA;
ALTER TABLE submission_photos ALTER COLUMN storage_path DROP NOT NULL;

-- ─────────────────────────────────────────────
-- Per-party vote counts, mirroring exactly what's on the physical result
-- sheet. total_valid_votes on the submission row is the authoritative sum
-- of these — validated in the app layer within the same transaction as
-- the insert (a CHECK constraint can't reference another table directly).
CREATE TABLE IF NOT EXISTS submission_party_votes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id   UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  party_id        UUID NOT NULL REFERENCES political_parties(id),
  votes           INTEGER NOT NULL CHECK (votes >= 0),
  UNIQUE (submission_id, party_id)
);

-- ─────────────────────────────────────────────
-- SEC-3 / SEC-4: submissions are immutable; corrections go through workflow
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE correction_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A correction request is a FULL proposed replacement result for an already
-- submitted polling unit result. It never overwrites the submission row:
--   * The original values are snapshotted here (original_* columns).
--   * The proposed values are stored separately (proposed_* columns).
--   * On approval the request links to the superseding submissions row it
--     created (applied_result_id); the original submissions row gets its
--     `superseded_by` pointer set so the official result is discoverable
--     while the immutable original stays intact for auditing.
-- The single-field placeholder (field_name/original_value/proposed_value) is
-- dropped — corrections span the whole result, not one column.
CREATE TABLE IF NOT EXISTS correction_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id     UUID NOT NULL REFERENCES submissions(id),

  -- Original submitted result (immutable snapshot taken at request time)
  original_registered  INTEGER NOT NULL,
  original_accredited  INTEGER NOT NULL,
  original_invalid     INTEGER NOT NULL,
  original_party_votes JSONB NOT NULL, -- { [party_id]: votes }

  -- Proposed corrected result (what the agent believes the sheet says)
  proposed_registered  INTEGER NOT NULL,
  proposed_accredited  INTEGER NOT NULL,
  proposed_invalid     INTEGER NOT NULL,
  proposed_party_votes JSONB NOT NULL, -- { [party_id]: votes }

  reason            TEXT NOT NULL,
  requested_by      UUID NOT NULL REFERENCES users(id),
  status            correction_status NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Correction-request metadata, stored separately from the original
  -- submission's capture metadata (which stays on the submission row).
  request_lat       DOUBLE PRECISION,
  request_lng       DOUBLE PRECISION,
  request_place     TEXT,

  -- Decision (authorized admin only). rejection_reason is required on reject.
  decided_by        UUID REFERENCES users(id),
  decided_at        TIMESTAMPTZ,
  rejection_reason  TEXT,

  -- Set on approval: the superseding submissions row that now holds the
  -- current official result (original is archived via submissions.superseded_by).
  applied_result_id UUID REFERENCES submissions(id)
);

-- Idempotent upgrade for databases where correction_requests pre-dates the
-- full-result model (the single-column placeholder field_name/original_value/
-- proposed_value). The CREATE above is a no-op when the table already exists,
-- so the placeholder columns are swapped for the snapshot columns here. A
-- NOT NULL column cannot be added to a non-empty table without a default, so
-- defaults are applied first and dropped once the column exists.
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS original_registered  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS original_accredited  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS original_invalid     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS original_party_votes JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS proposed_registered  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS proposed_accredited  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS proposed_invalid     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS proposed_party_votes JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE correction_requests ALTER COLUMN original_registered  DROP DEFAULT;
ALTER TABLE correction_requests ALTER COLUMN original_accredited  DROP DEFAULT;
ALTER TABLE correction_requests ALTER COLUMN original_invalid     DROP DEFAULT;
ALTER TABLE correction_requests ALTER COLUMN original_party_votes DROP DEFAULT;
ALTER TABLE correction_requests ALTER COLUMN proposed_registered  DROP DEFAULT;
ALTER TABLE correction_requests ALTER COLUMN proposed_accredited  DROP DEFAULT;
ALTER TABLE correction_requests ALTER COLUMN proposed_invalid     DROP DEFAULT;
ALTER TABLE correction_requests ALTER COLUMN proposed_party_votes DROP DEFAULT;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS request_lat       DOUBLE PRECISION;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS request_lng       DOUBLE PRECISION;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS request_place     TEXT;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS decided_by        UUID REFERENCES users(id);
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS decided_at        TIMESTAMPTZ;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS rejection_reason  TEXT;
ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS applied_result_id UUID REFERENCES submissions(id);
-- The single-field placeholder columns no longer exist in the model.
ALTER TABLE correction_requests DROP COLUMN IF EXISTS field_name;
ALTER TABLE correction_requests DROP COLUMN IF EXISTS original_value;
ALTER TABLE correction_requests DROP COLUMN IF EXISTS proposed_value;

-- SEC-4: correction requests are never edited/overwritten after creation —
-- the workflow only changes `status` (pending → approved|rejected). At most
-- one ACTIVE (pending) request may exist per submitted result; a new request
-- can be raised only after the previous one was decided.
DROP INDEX IF EXISTS one_pending_correction_per_submission;
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_correction_per_submission
  ON correction_requests (submission_id)
  WHERE status = 'pending';

-- A submitted result may carry new evidence with its correction request.
-- Bytes live in the DB (like submission_photos) so they survive Render's
-- ephemeral disk. Original evidence stays on submission_photos untouched.
CREATE TABLE IF NOT EXISTS correction_photos (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  correction_request_id  UUID NOT NULL REFERENCES correction_requests(id) ON DELETE CASCADE,
  data                   BYTEA,
  storage_path           TEXT,
  mime_type              TEXT NOT NULL,
  size_bytes             INTEGER NOT NULL,
  captured_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Superseding-record model (SEC-3 immutability + SEC-4 apply-on-approval):
--   * submissions.superseded_by: set on the ORIGINAL row when an approved
--     correction replaces it — the original values are never overwritten.
--   * submissions.corrected_by: set on the SUPERSEDING row that carries the
--     approved corrected result, tracing which decision produced it.
-- Both are workflow metadata, never result data.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES submissions(id);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES correction_requests(id);

-- The unique index backing SEC-5 must ignore superseded rows so the approved
-- correction's successor row can become the single accepted result for the
-- PU. Recreated (drop + create) so databases that already have the old
-- predicate pick up the new one on `npm run migrate`.
DROP INDEX IF EXISTS one_accepted_submission_per_pu;
CREATE UNIQUE INDEX IF NOT EXISTS one_accepted_submission_per_pu
  ON submissions (polling_unit_id)
  WHERE duplicate_of IS NULL AND superseded_by IS NULL AND status != 'flagged';

-- ─────────────────────────────────────────────
-- Invite codes: one-time, per-polling-unit codes that let an agent
-- self-register without an admin manually creating their account.
-- Vets *which polling unit* a self-registered agent can claim.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invite_codes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code                TEXT NOT NULL UNIQUE,
  polling_unit_id     UUID NOT NULL REFERENCES polling_units(id),
  created_by          UUID NOT NULL REFERENCES users(id),
  used_by             UUID REFERENCES users(id),
  used_at             TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A polling unit may have several unused codes issued over time (e.g. a
-- previous one expired), but only one may ever be *used* — that's what
-- actually claims the PU, enforced by the app layer at registration time.
CREATE INDEX IF NOT EXISTS invite_codes_polling_unit_idx ON invite_codes (polling_unit_id);

-- ─────────────────────────────────────────────
-- SEC-11: immutable audit log of every administrator action
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id        UUID NOT NULL REFERENCES users(id),
  action          TEXT NOT NULL,
  target_table    TEXT,
  target_id       UUID,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- Admin-controlled global settings (single-row key/value store).
-- 'agent_portal_active' (boolean) is the single administrative control that
-- deactivates every agent portal; enforcement is server-side, so a direct
-- API request cannot bypass it.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default: portal is ACTIVE for fresh databases (and idempotently preserved
-- for existing ones — ON CONFLICT never overwrites an admin's prior state).
INSERT INTO app_settings (key, value) VALUES ('agent_portal_active', '{"active": true}'::jsonb)
  ON CONFLICT (key) DO NOTHING;

-- Revoke UPDATE/DELETE at the app's DB role level for append-only tables
-- (run separately once the app's connection role is created):
-- REVOKE UPDATE, DELETE ON submissions, submission_photos, audit_log FROM app_role;
