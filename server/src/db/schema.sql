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
  deleted_at            TIMESTAMPTZ, -- soft-delete: remove from lists, never log in
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_or_phone CHECK (email IS NOT NULL OR phone_number IS NOT NULL)
);

-- `deleted_at` was added after the initial release; keep the migration safe
-- for databases that already had a `users` table without it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

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

CREATE TABLE IF NOT EXISTS correction_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id     UUID NOT NULL REFERENCES submissions(id),
  field_name        TEXT NOT NULL,
  original_value    TEXT NOT NULL,
  proposed_value    TEXT NOT NULL,
  reason            TEXT NOT NULL,
  requested_by      UUID NOT NULL REFERENCES users(id),
  status            correction_status NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- All admins must approve (SEC-4) — one row per required approver
CREATE TABLE IF NOT EXISTS correction_approvals (
  correction_request_id  UUID NOT NULL REFERENCES correction_requests(id),
  admin_id                UUID NOT NULL REFERENCES users(id),
  approved                BOOLEAN NOT NULL,
  decided_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (correction_request_id, admin_id)
);

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

-- Revoke UPDATE/DELETE at the app's DB role level for append-only tables
-- (run separately once the app's connection role is created):
-- REVOKE UPDATE, DELETE ON submissions, submission_photos, audit_log FROM app_role;
