# Apotheca API — PostgreSQL backend

The frontend runs standalone against browser storage, which means **one browser on one machine = one pharmacy**. The store room PC and the billing counter can't see the same stock, and two people can oversell the same last box because nothing is transactional.

This is the fix.

## Running it

With Docker:

```bash
docker compose up          # from the repo root — starts Postgres + the API
docker compose exec api npm run seed
```

Without Docker, if you have Postgres locally:

```bash
createdb apotheca
cd server
npm install
export DATABASE_URL=postgres://localhost/apotheca
npm run migrate
npm run seed
npm run dev
```

The seed prints a table of Staff IDs and passwords. The administrator gets a known password (`Apotheca#2026`, or `SEED_ADMIN_PASSWORD`); everyone else gets a one-time password and is forced to change it, exactly as real provisioning leaves them.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | `postgres://apotheca:apotheca@localhost:5432/apotheca` | Connection string |
| `PORT` | `3000` | Listen port |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins |
| `SESSION_TTL_HOURS` | `12` | How long a session token lives |
| `RATE_LIMIT` | `300` | Requests/minute/IP (sign-in is capped at 10) |
| `PG_POOL_MAX` | `10` | Pool size |

## The schema

`migrations/001_init.sql` — 13 tables, 2 views, 43 indexes. Run `npm run migrate`; it's forward-only and each file runs once inside its own transaction.

The parts that matter:

**Stock is per batch, never per product.** Expiry, cost and batch number belong to the batch. `UNIQUE (pharmacy_id, name, batch_no)` makes it impossible to key the same delivery twice — the client checks for this too, but the client can be bypassed.

**`qty INTEGER NOT NULL CHECK (qty >= 0)`.** An oversell fails at the database, not silently at negative stock. This is the last line of defence behind the `FOR UPDATE` lock in `POST /bills`.

**Money is `NUMERIC`, never float**, and `pg` returns it as a string so it can't be silently coerced. GST is back-calculated out of a tax-inclusive MRP in integer paise (`lib/money.ts`).

**`bill_lines` denormalises the drug details.** A reprinted invoice must show what was sold at the time, not what the batch record says today. `batch_id` is `ON DELETE RESTRICT`, so a batch that has been sold can't be deleted out from under an invoice.

**`stock_movements`** records every quantity change with a reason and a person. This is the table a drug inspector asks for.

**`prescriptions`** has a CHECK that a status of `dispensed` or `cancelled` must carry its timestamp, so there's no such thing as a half-closed prescription.

Two views do the work the client used to do in JavaScript:

- `dispensable_stock` — qty > 0 and not expired
- `product_availability` — per-product totals, which drive FEFO and the reorder report

## Accounts

There is no `POST /auth/signup`. Deliberately.

- `POST /auth/bootstrap` runs **once**, on an empty database, and creates the Chief Pharmacist. It 409s afterwards, so it can't be replayed to mint a second administrator.
- Every other account comes from `POST /staff`, guarded by the `manageStaff` capability. It generates the Staff ID and a one-time password, returns the password **once**, and sets `must_change_password`.
- A user with `must_change_password` can call `/auth/change-password` and nothing else — `blockIfPasswordChangePending` rejects every write.

Passwords are **Argon2id** (19 MiB, t=2), not the browser's SHA-256. Client-side hashing is fine for a single-machine prototype; once passwords cross a network they need a memory-hard KDF.

Session tokens are random 32-byte values. Only their SHA-256 digest is stored, so a database dump doesn't hand over live sessions. Changing a password, resetting one, disabling an account or changing a role all revoke every session for that user.

Five failed sign-ins locks the account for 15 minutes, and every failure is written to `audit_log` — a run of them against one Staff ID is exactly what an administrator needs to see.

## Roles

`lib/auth.ts` mirrors `src/domain/roles.ts` on the client. The client copy decides what a user **sees**; this copy decides what the server will actually **do**. A hidden button is a courtesy; `requires("deleteStock")` is the enforcement.

| | Admin | Pharmacist | Doctor | Staff | Nurse |
|---|:-:|:-:|:-:|:-:|:-:|
| Write prescription | | | ✓ | | |
| Fill prescription | ✓ | ✓ | | ✓ | |
| Receive stock | ✓ | ✓ | | ✓ | |
| Adjust quantities | ✓ | ✓ | | ✓ | |
| Delete a batch | ✓ | | | | |
| Write off expired | ✓ | ✓ | | | |
| Return a bill | ✓ | ✓ | | | |
| See cost & margin | ✓ | ✓ | | | |
| Issue accounts | ✓ | | | | |

`GET /stock` returns `cost` as `NULL` for roles without `viewCost` — the column never leaves the database, rather than being hidden in the UI.

## Endpoints

```
POST   /auth/bootstrap            once, on an empty database
POST   /auth/login                Staff ID or email + password → bearer token
POST   /auth/logout
GET    /auth/me
POST   /auth/change-password      allowed while must_change_password is set

GET    /staff                     everyone in your pharmacy
POST   /staff                     issue an account → { staffId, temporaryPassword }
POST   /staff/:id/reset-password  → new one-time password, kills their sessions
PATCH  /staff/:id/active          disable / re-enable
PATCH  /staff/:id/role            reissues the Staff ID, since the prefix encodes the role

GET    /stock                     ?search= &form= &dispensableOnly=
GET    /stock/allocate            ?name=&form=&strength=&qty=  → FEFO batch list
POST   /stock                     receive a delivery (many batches, one transaction)
PATCH  /stock/:id/qty             adjust with a mandatory reason code
POST   /stock/write-off-expired
GET    /stock/reorder
GET    /stock/expiry

GET    /bills                     ?search= &limit=
POST   /bills                     issue — see below
POST   /bills/:id/return          void and restock

GET    /prescriptions             ?status=   doctors see only their own
POST   /prescriptions
POST   /prescriptions/:id/cancel

GET    /audit                     Chief Pharmacist and Pharmacist only
GET    /health
```

## `POST /bills` — the reason this backend exists

The whole operation is one transaction:

1. Lock every batch involved with `FOR UPDATE`, **ordered by id** so two tills can't deadlock against each other.
2. Re-check quantity and expiry against the *locked* rows — not the ones the browser saw a moment ago.
3. Recompute the totals server-side. Whatever the client sent is ignored; if the two ever disagree, the server is right and that's a bug worth finding.
4. Insert the bill, decrement the stock, write a `stock_movements` row per line.
5. Close out the prescription, if the bill came from one.

If any step throws, none of it happened. Duplicate batch ids in the request are collapsed first, so a caller can't split one batch across two lines to slip past the quantity check.

## Wiring the frontend to it

Not done yet — the frontend still talks to `src/platform/web/store.ts`. The seam is deliberate: `src/platform/types.ts` defines the four contracts, and `src/data/repository.ts` is the only file that touches storage.

Two honest options:

1. **A `fetch`-backed `KeyValueStore`.** Quick, gets shared data across machines today, but it's a stopgap — a key-value store over HTTP has no transactions, so you keep the oversell bug you came here to fix.
2. **A proper API client** replacing `repository.ts` with typed calls to the endpoints above. More work, and the correct answer, because it's what makes step 1–5 of `POST /bills` actually apply.

Take option 2. See [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Verification

The schema has been executed end to end against a real PostgreSQL engine — every constraint confirmed firing:

- duplicate Staff ID, malformed Staff ID, case-variant email, invalid role enum, invalid GST rate
- duplicate batch number for the same drug
- `qty` driven below zero, both directly and inside a rolled-back transaction
- deleting a batch that appears on an invoice (RESTRICT)
- marking a prescription dispensed without a timestamp
- FEFO ordering returning the 48-day batch before the 400-day one
