-- ============================================================================
-- Apotheca — initial schema
--
-- Design notes that matter:
--
--  * Stock is tracked per BATCH, never per product. Expiry, cost and batch
--    number belong to the batch, and dispensing the wrong batch is the mistake
--    this whole system exists to prevent.
--  * Money is NUMERIC, never float. GST is back-calculated out of a
--    tax-inclusive MRP (Indian convention), so a rounding drift shows up on a
--    tax invoice.
--  * There is no public sign-up. `users` rows are created by an administrator,
--    or by the one-time bootstrap.
--  * Quantities are guarded by a CHECK, so an oversell fails at the database
--    rather than silently going negative.
-- ============================================================================

BEGIN;

-- gen_random_uuid() is core since PostgreSQL 13, so no pgcrypto needed.
CREATE EXTENSION IF NOT EXISTS citext;  -- case-insensitive email addresses

-- ---------------------------------------------------------------- enums ---

CREATE TYPE role_name AS ENUM (
  'Chief Pharmacist',
  'Pharmacist',
  'Doctor',
  'Pharmacy Staff',
  'Nurse'
);

CREATE TYPE bill_status AS ENUM ('issued', 'returned');

CREATE TYPE rx_status AS ENUM ('open', 'dispensed', 'cancelled');

CREATE TYPE adjust_reason AS ENUM (
  'Correction',
  'Damaged',
  'Expired write-off',
  'Customer return',
  'Supplier return',
  'Internal issue'
);

CREATE TYPE stock_movement_kind AS ENUM (
  'receive',
  'dispense',
  'return',
  'adjust',
  'writeoff',
  'delete'
);

-- ------------------------------------------------------------ pharmacies ---

CREATE TABLE pharmacies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  gstin       TEXT,
  licence_no  TEXT,
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------- users ---

CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id           UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,

  -- Login handle issued by an administrator, e.g. PHARM-04213.
  staff_id              TEXT NOT NULL UNIQUE,
  -- CITEXT so "Meera@hospital.in" and "meera@hospital.in" are the same login.
  email                 CITEXT NOT NULL UNIQUE,

  name                  TEXT NOT NULL,
  phone                 TEXT NOT NULL DEFAULT '',
  department            TEXT NOT NULL DEFAULT '',
  role                  role_name NOT NULL,

  -- Argon2id encoded string; contains its own salt and parameters.
  password_hash         TEXT NOT NULL,
  security_question     TEXT NOT NULL DEFAULT '',
  security_answer_hash  TEXT,

  must_change_password  BOOLEAN NOT NULL DEFAULT TRUE,
  active                BOOLEAN NOT NULL DEFAULT TRUE,

  failed_attempts       INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  last_login_at         TIMESTAMPTZ,

  CONSTRAINT users_staff_id_format CHECK (staff_id ~ '^[A-Z]+-[0-9]{5}')
);

CREATE INDEX users_pharmacy_idx ON users (pharmacy_id);
CREATE INDEX users_role_idx     ON users (role) WHERE active;

-- ------------------------------------------------------------- sessions ---

CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the opaque bearer token. The token itself is never stored.
  token_hash  TEXT NOT NULL UNIQUE,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  user_agent  TEXT,
  ip          INET
);

CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expiry_idx  ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------- stock ---

CREATE TABLE batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id   UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,

  name          TEXT NOT NULL,
  brand         TEXT NOT NULL DEFAULT '',
  form          TEXT NOT NULL,
  strength      TEXT NOT NULL,

  batch_no      TEXT NOT NULL,
  expiry        DATE NOT NULL,

  qty           INTEGER NOT NULL CHECK (qty >= 0),

  -- Tax-inclusive selling price per unit.
  mrp           NUMERIC(10, 2) NOT NULL CHECK (mrp >= 0),
  -- Purchase price per unit, for valuation and write-off loss.
  cost          NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  gst           SMALLINT NOT NULL CHECK (gst IN (0, 5, 12, 18)),

  mfr           TEXT NOT NULL DEFAULT '',
  rack          TEXT NOT NULL DEFAULT '',
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  drug_class    TEXT NOT NULL DEFAULT '',
  schedule      TEXT NOT NULL DEFAULT 'OTC',

  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by      UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Receiving the same batch number of the same drug twice is a data-entry
  -- error, and the client checks for it. This makes it impossible.
  CONSTRAINT batches_unique_batch UNIQUE (pharmacy_id, name, batch_no)
);

-- FEFO and the expiry desk both scan by expiry within a pharmacy.
CREATE INDEX batches_fefo_idx
  ON batches (pharmacy_id, expiry)
  WHERE qty > 0;

-- Grouping batches into a sellable product.
CREATE INDEX batches_product_idx
  ON batches (pharmacy_id, lower(name), form, lower(strength));

-- Free-text search over the shelf.
CREATE INDEX batches_search_idx
  ON batches USING gin (
    to_tsvector('simple', name || ' ' || brand || ' ' || batch_no || ' ' || mfr)
  );

CREATE INDEX batches_reorder_idx
  ON batches (pharmacy_id)
  WHERE reorder_level > 0;

-- -------------------------------------------------------------- patients ---

CREATE TABLE patients (
  id          TEXT PRIMARY KEY,                -- PAT-12345
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  age         TEXT NOT NULL DEFAULT '',
  sex         TEXT NOT NULL DEFAULT '' CHECK (sex IN ('', 'M', 'F', 'O')),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX patients_name_idx  ON patients (pharmacy_id, lower(name));
CREATE INDEX patients_phone_idx ON patients (pharmacy_id, phone) WHERE phone <> '';

-- -------------------------------------------------------- prescriptions ---

CREATE TABLE prescriptions (
  id             TEXT PRIMARY KEY,             -- RX-2026-00001
  pharmacy_id    UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,

  written_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  doctor_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  patient_name   TEXT NOT NULL,
  patient_ref    TEXT REFERENCES patients(id) ON DELETE SET NULL,
  patient_age    TEXT NOT NULL DEFAULT '',
  diagnosis      TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',

  status         rx_status NOT NULL DEFAULT 'open',
  dispensed_at   TIMESTAMPTZ,
  dispensed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  bill_id        UUID,                          -- FK added after bills exists
  cancelled_at   TIMESTAMPTZ,
  cancel_reason  TEXT,

  -- A prescription is either open, or closed out with a timestamp. Nothing in
  -- between is meaningful.
  CONSTRAINT rx_closed_consistently CHECK (
    (status = 'open'      AND dispensed_at IS NULL AND cancelled_at IS NULL) OR
    (status = 'dispensed' AND dispensed_at IS NOT NULL) OR
    (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);

-- The counter queue: open prescriptions, newest first.
CREATE INDEX rx_queue_idx
  ON prescriptions (pharmacy_id, written_at DESC)
  WHERE status = 'open';

CREATE INDEX rx_doctor_idx ON prescriptions (doctor_id, written_at DESC);

CREATE TABLE prescription_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id TEXT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  line_no         SMALLINT NOT NULL,

  name            TEXT NOT NULL,
  form            TEXT NOT NULL,
  strength        TEXT NOT NULL,

  dose_per_take   NUMERIC(6, 2) NOT NULL CHECK (dose_per_take > 0),
  frequency       TEXT NOT NULL,
  duration_days   INTEGER NOT NULL CHECK (duration_days > 0),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  instructions    TEXT NOT NULL DEFAULT '',

  UNIQUE (prescription_id, line_no)
);

-- ----------------------------------------------------------------- bills ---

CREATE TABLE bills (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id    UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,

  bill_no        TEXT NOT NULL,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  patient_name   TEXT NOT NULL,
  patient_ref    TEXT REFERENCES patients(id) ON DELETE SET NULL,
  doctor         TEXT NOT NULL DEFAULT '',
  prescription_id TEXT REFERENCES prescriptions(id) ON DELETE SET NULL,

  payment_mode   TEXT NOT NULL,
  payment_ref    TEXT NOT NULL DEFAULT '',

  taxable        NUMERIC(12, 2) NOT NULL CHECK (taxable >= 0),
  gst_total      NUMERIC(12, 2) NOT NULL CHECK (gst_total >= 0),
  discount_pct   NUMERIC(5, 2)  NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  discount_amt   NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amt >= 0),
  net            NUMERIC(12, 2) NOT NULL CHECK (net >= 0),

  status         bill_status NOT NULL DEFAULT 'issued',
  returned_at    TIMESTAMPTZ,
  returned_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  return_reason  TEXT,

  issued_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Invoice numbers are a legal series. Two bills must never share one.
  CONSTRAINT bills_no_unique UNIQUE (pharmacy_id, bill_no)
);

CREATE INDEX bills_recent_idx  ON bills (pharmacy_id, issued_at DESC);
CREATE INDEX bills_patient_idx ON bills (pharmacy_id, lower(patient_name));
CREATE INDEX bills_ref_idx     ON bills (patient_ref) WHERE patient_ref IS NOT NULL;

ALTER TABLE prescriptions
  ADD CONSTRAINT prescriptions_bill_fk
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE SET NULL;

CREATE TABLE bill_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id     UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  line_no     SMALLINT NOT NULL,

  -- RESTRICT, not CASCADE: a batch that has been sold cannot be deleted, or
  -- the invoice stops reconciling.
  batch_id    UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,

  -- Denormalised on purpose. A reprinted invoice must show what was sold at
  -- the time, not what the batch record says today.
  name        TEXT NOT NULL,
  brand       TEXT NOT NULL DEFAULT '',
  form        TEXT NOT NULL,
  strength    TEXT NOT NULL,
  batch_no    TEXT NOT NULL,
  expiry      DATE NOT NULL,

  qty         INTEGER NOT NULL CHECK (qty > 0),
  mrp         NUMERIC(10, 2) NOT NULL CHECK (mrp >= 0),
  gst         SMALLINT NOT NULL,

  UNIQUE (bill_id, line_no)
);

CREATE INDEX bill_lines_batch_idx ON bill_lines (batch_id);

-- ------------------------------------------------------- stock movements ---
-- Every change in quantity, with a reason and a person. This is the table a
-- drug inspector asks for.

CREATE TABLE stock_movements (
  id          BIGSERIAL PRIMARY KEY,
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  batch_id    UUID REFERENCES batches(id) ON DELETE SET NULL,

  kind        stock_movement_kind NOT NULL,
  -- Negative for issue, positive for receipt/return.
  delta       INTEGER NOT NULL,
  qty_after   INTEGER,

  reason      adjust_reason,
  note        TEXT NOT NULL DEFAULT '',

  bill_id     UUID REFERENCES bills(id) ON DELETE SET NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_user     UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX stock_movements_batch_idx ON stock_movements (batch_id, at DESC);
CREATE INDEX stock_movements_time_idx  ON stock_movements (pharmacy_id, at DESC);

-- ----------------------------------------------------------------- audit ---

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT NOT NULL,
  action      TEXT NOT NULL,
  summary     TEXT NOT NULL,
  meta        JSONB,
  ip          INET
);

CREATE INDEX audit_time_idx   ON audit_log (pharmacy_id, at DESC);
CREATE INDEX audit_action_idx ON audit_log (action, at DESC);
CREATE INDEX audit_actor_idx  ON audit_log (actor_id, at DESC);

-- ------------------------------------------------------------ formulary ---
-- Reference data. The client ships a copy for offline use; this is the
-- authoritative one.

CREATE TABLE drugs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generic     TEXT NOT NULL UNIQUE,
  brands      TEXT[] NOT NULL DEFAULT '{}',
  drug_class  TEXT NOT NULL DEFAULT '',
  schedule    TEXT NOT NULL DEFAULT 'OTC'
);

CREATE TABLE drug_forms (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id   UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
  form      TEXT NOT NULL,
  strengths TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (drug_id, form)
);

-- ---------------------------------------------------------------- views ---

-- What the counter can actually sell right now.
CREATE VIEW dispensable_stock AS
SELECT
  b.*,
  (b.expiry - CURRENT_DATE) AS days_left
FROM batches b
WHERE b.qty > 0
  AND b.expiry >= CURRENT_DATE;

-- Product-level availability, which is what FEFO and the reorder report use.
CREATE VIEW product_availability AS
SELECT
  pharmacy_id,
  name,
  form,
  strength,
  SUM(qty)                        AS on_hand,
  MAX(reorder_level)              AS reorder_level,
  MIN(expiry)                     AS nearest_expiry,
  COUNT(*)                        AS batch_count
FROM dispensable_stock
GROUP BY pharmacy_id, name, form, strength;

COMMIT;
