# Architecture

This document exists to answer one question: **how do I turn this into a real product — a server-backed web app, an iOS/Android app, a desktop app — without rewriting it?**

The short answer is that the app is split into four layers, and only one of them knows what a browser is.

```
┌──────────────────────────────────────────────────────────┐
│  features/     screens — React, composes everything      │  rewrite per platform UI
│  ui/           primitives, tables, toasts, theme         │  (React Native: rewrite)
│  components/   domain-aware widgets                      │  (Electron/web: reuse)
├──────────────────────────────────────────────────────────┤
│  state/        reducer + store (React, no DOM)           │  reuse as-is in RN
│  data/         repository, schema version, migrations    │  reuse as-is
├──────────────────────────────────────────────────────────┤
│  platform/     storage · crypto · files · print          │  ← WRITE ONE NEW FOLDER
├──────────────────────────────────────────────────────────┤
│  domain/       types, rules, money, expiry, FEFO, CSV    │  reuse everywhere, unchanged
└──────────────────────────────────────────────────────────┘
```

## The rule that makes this work

**`src/domain` may not import React, touch `window`, or call a browser API.**

That is the whole discipline. Everything that decides *what is true* — how GST splits out of an MRP, which batch FEFO should pick, when a batch counts as expired, what a valid bill looks like, what a bill number should be — lives in `domain/` as plain TypeScript functions over plain data.

If you ever find yourself wanting `document` inside `domain/`, the thing you're writing belongs in `platform/` instead.

The practical payoff: `domain/` is about 1,600 lines that run identically in a browser, in React Native's JS engine, in Electron's main process, and in Node on a server. When you build the backend, the billing maths in your API is *literally this code*, so the server and the client can't disagree about a total.

## The four platform contracts

`src/platform/types.ts` defines everything the app needs from the device it's on:

| Contract | What it does | Web today | iOS/Android | Electron | Server |
|---|---|---|---|---|---|
| `KeyValueStore` | async get/set/delete/keys | `localStorage` | MMKV or AsyncStorage | `fs` or SQLite | Postgres |
| `CryptoAdapter` | salt + password hash | `crypto.subtle` SHA-256 | `expo-crypto` | `node:crypto` | **argon2 / bcrypt** |
| `FileAdapter` | save/open a file | `Blob` + `<a download>` | `expo-sharing` | `dialog.showSaveDialog` | HTTP response |
| `PrintAdapter` | print an invoice | `window.print()` | `expo-print` | `webContents.print()` | PDF generation |

`src/platform/index.ts` is the only place these are wired together. To add a platform you write `src/platform/native/` (or `electron/`), then either branch in `index.ts` or let the bundler pick — Metro resolves `index.native.ts` automatically for React Native.

**Nothing above `src/platform` should need to change.**

## Porting checklist

### → React Native (iOS + Android)

1. `npx create-expo-app apotheca-mobile --template blank-typescript`
2. Copy `src/domain/`, `src/data/`, `src/state/` across **unchanged**.
3. Write `src/platform/native/`:
   ```ts
   // store.ts — MMKV is the fast choice; AsyncStorage works too
   import { MMKV } from "react-native-mmkv";
   const kv = new MMKV();
   export const nativeStore: KeyValueStore = {
     name: "MMKV", durable: true,
     async get(k) { return kv.getString(k) ?? null },
     async set(k, v) { kv.set(k, v) },
     async delete(k) { kv.delete(k) },
     async keys(p = "") { return kv.getAllKeys().filter(k => k.startsWith(p)) },
   };
   ```
   plus `expo-crypto` for hashing and `expo-sharing` for exports.
4. Rebuild `ui/` and `features/` with React Native components. The *logic* in each screen — what it computes, what it validates — comes from `domain/`, so this is genuinely a re-skin rather than a rewrite. `BillingScreen` is ~450 lines of JSX over roughly 15 lines of domain calls.

Realistic estimate: the domain and state layers port in an afternoon; the UI is the actual work.

### → Desktop (Electron or Tauri)

Faster than mobile, because the UI is already web. Point Electron at `dist/`, then swap `platform/` for a Node-backed store (SQLite via `better-sqlite3`) and `dialog.showSaveDialog`. You get real file paths, real printing, and no localStorage quota.

### → Server-backed (the important one)

localStorage means **each machine has its own separate pharmacy**. The store room PC and the billing counter do not see the same stock. That is the single biggest limitation of this build.

The path:

1. Stand up an API. Reuse `domain/` on the server for validation and billing maths.
2. Replace `platform/web/store.ts` with a `fetch`-backed `KeyValueStore`. This gets you shared data quickly, but it is a stopgap — a key-value store over HTTP has no transactions, so two counters can still oversell the same batch.
3. Then do it properly: real endpoints (`POST /bills`, `PATCH /batches/:id`) where issuing a bill is **one database transaction** that decrements stock and inserts the bill together. `src/data/repository.ts` is the seam — it's the only file that talks to storage.
4. Move password hashing server-side to Argon2id. The current SHA-256 is fine for a local prototype and not fine for a network service.

Suggested schema:

```sql
create table batches (
  id uuid primary key, name text not null, brand text, form text not null,
  strength text not null, qty integer not null check (qty >= 0),
  batch_no text not null, expiry date not null,
  mrp numeric(10,2) not null, cost numeric(10,2) not null, gst smallint not null,
  mfr text, rack text, reorder_level integer default 0,
  added_at timestamptz not null default now(), added_by uuid references users(id),
  unique (name, batch_no)
);
create index on batches (expiry);            -- FEFO + the expiry desk
create index on batches (name, form, strength);  -- product grouping

create table bills (
  id uuid primary key, no text unique not null, at timestamptz not null,
  patient_name text not null, patient_id text, doctor text,
  taxable numeric(10,2), gst_total numeric(10,2),
  discount_pct numeric(5,2), discount_amt numeric(10,2), net numeric(10,2),
  status text not null default 'issued', by_user_id uuid references users(id)
);
create table bill_lines (
  bill_id uuid references bills(id) on delete cascade,
  batch_id uuid references batches(id),
  qty integer not null, mrp numeric(10,2) not null, gst smallint not null
);
create table audit (
  id uuid primary key, at timestamptz not null default now(),
  actor_id uuid references users(id), action text not null,
  summary text not null, meta jsonb
);
```

The `unique (name, batch_no)` constraint is what `findDuplicateBatch` enforces client-side today.

## Data flow

One direction, no exceptions:

```
User action
  → actions.something()          state/store.tsx — async, does crypto/IO
      → domain function          pure — computes the next value
      → dispatch(action)         reducer — pure state transition
      → save*(nextValue)         repository — queued, debounced write
  → React re-renders
      → useMemo selectors        buildStockIndex, bucketByExpiry, …
```

Three separate React contexts, deliberately:

- `StateContext` — changes on every mutation
- `ActionsContext` — **stable for the app's lifetime**, so a form that only dispatches never re-renders on unrelated state changes
- `DerivedContext` — memoised indexes, recomputed only when their inputs move

## Performance notes

These were real problems in v1, not theoretical ones:

| Was | Now |
|---|---|
| `stock.find()` inside `stock.map()` when billing — O(n·m) | `Map`-based `applyQuantityDeltas` — O(n) |
| Type-ahead rebuilt drug × form × strength on every keystroke | `CATALOG_PRODUCTS` flattened once at module load |
| Search re-scanned every batch per keystroke | `StockIndex` with a precomputed haystack, plus a 140 ms debounce |
| Every mutation serialised and wrote the whole array synchronously | Writes queued and coalesced per key on a 120 ms debounce |
| `bills.length + 1` for the invoice number | Highest sequence actually issued this year, scoped per year |
| Float accumulation across bill lines | Integer paise throughout, rounded once |
| CSS as a JS template string, re-parsed at runtime | Real `.css` file, extracted and cached by the browser |
| Unique-ID generation scanned a growing array per attempt | Taken-set built once, O(1) per attempt |

## Schema versioning

`src/data/repository.ts` holds `SCHEMA_VERSION` and a `migrate()` that upgrades records written by earlier versions. v1 wrote raw arrays under `rx:*` with no version marker, so any field rename would have silently corrupted a live pharmacy's data.

- **v2** renames those keys, converts `pass`→`passwordHash`, `patient`→`patientName`, `id`→`batchId` on bill lines, and adds `status`.
- **v3** adds e-prescriptions. Nothing to convert — v2 installs start with an empty prescription list.

A server port needs two more tables:

```sql
create table prescriptions (
  id text primary key, at timestamptz not null,
  doctor_id uuid references users(id), patient_name text not null,
  patient_id text, patient_age text, diagnosis text, notes text,
  status text not null default 'open',
  dispensed_at timestamptz, dispensed_by uuid references users(id),
  bill_no text references bills(no)
);
create table prescription_items (
  id uuid primary key,
  prescription_id text references prescriptions(id) on delete cascade,
  name text not null, form text not null, strength text not null,
  dose_per_take numeric(5,2) not null, frequency text not null,
  duration_days integer not null, qty integer not null, instructions text
);
create index on prescriptions (status, at desc);   -- the counter queue
```

**When you change a stored shape, bump `SCHEMA_VERSION` and add a migration branch.** Existing installs will have real data in them.

## Where the seams are

If you're picking this up cold, these are the files that matter most:

| File | Why |
|---|---|
| `src/domain/inventory.ts` | FEFO allocation and the stock index — the core algorithm |
| `src/domain/money.ts` | GST maths. Get this wrong and invoices are wrong |
| `src/domain/roles.ts` | Permissions. `canView` / `canDo` are consulted by the nav *and* the screens |
| `src/domain/prescriptions.ts` | Dosing arithmetic and availability matching |
| `src/platform/types.ts` | The four contracts. Read this before porting |
| `src/data/repository.ts` | Every read and write goes through here |
| `src/state/store.tsx` | Every mutation the app can perform, in one file |
