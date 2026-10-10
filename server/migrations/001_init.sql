-- ClinicQ schema. Queue invariants are enforced by the database, not just the app:
--   * token numbers are unique per clinic per day
--   * a phone number can hold only one active token per clinic per day
--   * at most one patient is being served per clinic at a time

CREATE TABLE clinics (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$'),
  name                 text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  doctor_name          text NOT NULL DEFAULT '',
  address              text NOT NULL DEFAULT '',
  phone                text NOT NULL DEFAULT '',
  timezone             text NOT NULL DEFAULT 'Asia/Kolkata',
  default_consult_secs integer NOT NULL DEFAULT 420 CHECK (default_consult_secs BETWEEN 60 AND 3600),
  daily_limit          integer NOT NULL DEFAULT 60 CHECK (daily_limit BETWEEN 1 AND 500),
  booking_open         boolean NOT NULL DEFAULT true,
  paused               boolean NOT NULL DEFAULT false,
  pause_message        text NOT NULL DEFAULT '',
  is_demo              boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_clinic_idx ON users (clinic_id);

-- One row per clinic per day; incremented under a row lock to hand out token numbers.
CREATE TABLE daily_counters (
  clinic_id    uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  last_number  integer NOT NULL,
  PRIMARY KEY (clinic_id, service_date)
);

CREATE TABLE tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  service_date  date NOT NULL,
  number        integer NOT NULL CHECK (number > 0),
  -- Sort key for the waiting line. Starts equal to `number`; a re-queued no-show
  -- gets a fractional position so it slots in right after the current patient.
  queue_pos     numeric NOT NULL,
  public_code   text NOT NULL UNIQUE,
  patient_name  text NOT NULL,
  phone         text NOT NULL,
  reason        text NOT NULL DEFAULT '',
  source        text NOT NULL CHECK (source IN ('online', 'walkin')),
  status        text NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'serving', 'done', 'no_show', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  called_at     timestamptz,
  completed_at  timestamptz,
  cancelled_at  timestamptz,
  UNIQUE (clinic_id, service_date, number)
);
CREATE INDEX tokens_queue_idx ON tokens (clinic_id, service_date, status, queue_pos);
CREATE UNIQUE INDEX tokens_one_active_per_phone
  ON tokens (clinic_id, service_date, phone) WHERE status IN ('waiting', 'serving') AND phone <> '';
CREATE UNIQUE INDEX tokens_one_serving
  ON tokens (clinic_id, service_date) WHERE status = 'serving';
