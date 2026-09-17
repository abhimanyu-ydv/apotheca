# Apotheca — Hospital Pharmacy Management

[![CI](https://github.com/abhimanyu-ydv/apotheca/actions/workflows/ci.yml/badge.svg)](https://github.com/abhimanyu-ydv/apotheca/actions/workflows/ci.yml)

Batch-level stock control, FEFO dispensing, expiry management, GST billing and a full audit trail for a hospital pharmacy counter.

## Running it

You need [Node.js](https://nodejs.org) 18 or newer (`node -v` to check).

```bash
npm install
npm run dev
```

Opens on `http://localhost:5173`. `Ctrl + C` to stop.

Other scripts:

```bash
npm run build       # typecheck, then build to dist/
npm run typecheck   # types only
npm run check       # types + unused imports/locals
npm run preview     # serve the built output
```

## Accounts: there is no sign-up

On first run you create **one** account — the Chief Pharmacist. That is the only self-service account the system will ever allow.

Everyone else is **issued** an account from the admin console:

1. Admin → **Staff & access** → *Issue an account*. Pick a role, enter a name and email.
2. The system generates a **Staff ID** (`DOC-74974`, `PHARM-04213`, …) and a **one-time password**, and shows them once on a printable slip.
3. The holder signs in with the Staff ID or their email, and is **forced to choose their own password** before anything else renders. The issued password stops working the moment they do.

**The demo accounts in `server/src/seed.ts` (`sharma@hospital.in` and the rest) only exist when you run the PostgreSQL backend.** The default browser-only app starts with no accounts at all — you create the Chief Pharmacist on first run. If you forget that password, use **Forgot your password?** and answer your security question; there is no back door.

The admin can also reset a password (which kills every live session), disable an account, or change someone's role — a role change reissues the Staff ID, because the prefix encodes the role.

## First run

The shelf comes pre-loaded with 16 sample batches, two of them already expired.

Two things worth trying immediately:

1. **Dispense → search "Paracetamol" → pick 650 mg → quantity 100 → Auto (FEFO).**
   There are two batches: 60 units expiring in 48 days and 420 expiring in 400 days. The system takes all 60 from the near-expiry batch first, then 40 from the other. That is the rule pharmacies are meant to follow and the thing people get wrong by hand.

2. **Dispense → search "Azithromycin".**
   Its only batch is expired. The counter refuses to sell it.

## What's in it

| Screen | What it does |
|---|---|
| **Dashboard** | Stock value, today's sales, expiry alerts, reorder list, fastest movers |
| **Prescriptions** | Doctors write e-prescriptions; the counter works the queue and dispenses them |
| **Receive stock** | Goods inward with type-ahead lookup, multi-batch cart, duplicate-batch detection |
| **Stock** | Every batch, sortable, with shelf-life bars and reason-coded adjustments |
| **Dispense** | FEFO auto-allocation or manual batch pick, GST invoice, hard expiry block |
| **Bills** | Searchable history, reprintable invoices, **returns that restock** |
| **Expiry** | Expired / 30-day / 90-day buckets with write-off values and bulk write-off |
| **Patients** | Registry with auto-generated IDs and per-patient dispensing history |
| **Audit** | Every stock movement, bill, return and account change, with who and when |
| **Staff & data** | Accounts, enforced role matrix, JSON backup **and restore**, CSV exports |

## Four consoles, not one app with buttons hidden

Each role opens a **different application** — its own home screen, navigation,
accent colour and vocabulary.

| Console | Who | Accent | Opens on | Nav |
|---|---|---|---|---|
| **Administrator** | Chief Pharmacist | dark teal | Staff & access | 11 items |
| **Dispensing / Counter** | Pharmacist, Pharmacy Staff | teal | Dispense & bill | 9 / 8 items |
| **Clinical** | Doctor | blue | Prescription pad | 5 items |
| **Ward** | Nurse | slate | Check availability | 5 items, read-only |

The administrator's console opens on staff management, not stock — running the
building is the job only they have. The doctor's opens on the prescription pad.
The counter's opens on dispensing, with the prescription queue and the expired
count pinned in the top bar.

Purchase cost and margin are hidden from Doctor and Nurse — clinically
irrelevant and commercially sensitive. They see availability and MRP.

Permissions are enforced three times over: the console decides the navigation,
`canView` gates the screen, and `canDo` gates each action. The PostgreSQL API
checks again server-side, because a hidden button is a courtesy, not a control.

## The prescription loop

This is the flow the whole role system exists for:

1. A **Doctor** searches the formulary, sets dose / frequency (OD, BD, TDS, QID,
   HS, SOS, STAT) / duration. The quantity to dispense is calculated for them,
   and live stock is shown while prescribing so they can pick an alternative
   before the patient walks anywhere.
2. The prescription lands in the **counter queue** with a stock-availability
   flag — in stock, part stock, or out.
3. A **Pharmacist or Pharmacy Staff** hits *Dispense*. Every line is run through
   FEFO, the cart is pre-filled with real batches, and patient and doctor are
   carried across.
4. Issuing the bill closes the prescription out against the bill number. The
   doctor sees it turn *dispensed*, by whom, and when.

Every step is in the audit log.

## Project layout

```
index.html
docker-compose.yml               Postgres + API
vite.config.ts
tsconfig.json

server/                          PostgreSQL backend
  migrations/001_init.sql          13 tables, 2 views, 43 indexes
  src/lib/                         db (transactions), auth (Argon2 + RBAC), ids, money
  src/routes/                      auth · staff · stock · bills · prescriptions
  README.md                        schema notes and the endpoint list

src/
  domain/          pure TypeScript — no React, no browser APIs
    types.ts         every entity
    roles.ts         permissions (canView / canDo)
    catalog.ts       33-drug formulary + search index
    money.ts         GST maths in integer paise
    expiry.ts        shelf-life rules
    inventory.ts     stock index + FEFO allocator
    billing.ts       cart rules, bill construction, returns
    prescriptions.ts dosing maths, validation, availability matching
    search.ts        formulary + shelf search
    audit.ts         audit trail
    csv.ts           CSV generation
    seed.ts, ids.ts

  platform/        ← the only folder that changes per platform
    types.ts         KeyValueStore · CryptoAdapter · FileAdapter · PrintAdapter
    web/             localStorage, crypto.subtle, Blob download, window.print

  data/repository.ts   persistence, schema version, migrations, write queue
  state/               reducer (pure) + store provider
  ui/                  primitives, DataTable, toasts, theme.css
  components/          domain-aware widgets
  features/            one folder per screen
  app/
    PanelRouter.tsx      picks the console for your role
    PanelChrome.tsx      shared shell each console configures
    panels/              AdminPanel · CounterPanel · DoctorPanel · WardPanel

legacy/            the previous single-file build, kept for reference
```

**`src/domain` is the part that ports unchanged to iOS, Android, desktop or a server.** See [ARCHITECTURE.md](ARCHITECTURE.md) for how.

## Where data lives

**Standalone (default):** browser localStorage, keys prefixed `apotheca:`, with a schema version and migrations. Records from the previous JavaScript build (`rx:*`) upgrade automatically on first load.

- Records survive closing the browser and restarting the machine.
- Records are tied to **one browser on one computer**. The store room PC and the billing counter will not see the same stock, and two people can oversell the same last box because nothing is transactional.
- Clearing site data wipes the pharmacy. Use **Data & backup → Export full backup** first.

**With PostgreSQL:** one shared dataset, real transactions, Argon2 password hashing and server-side permission checks.

```bash
docker compose up
docker compose exec api npm run seed     # prints Staff IDs + passwords
```

The schema, the endpoint list and the `POST /bills` transaction are documented in [server/README.md](server/README.md). Connecting the frontend to it is the remaining step — the seam is `src/data/repository.ts`, which is the only file that touches storage.

## Two things that can trip you up

**Password hashing needs a secure context.** The app uses `crypto.subtle`, which only exists on `localhost` or over HTTPS. Testing from another machine over plain `http://192.168.x.x` will make sign-in fail — the app now says so explicitly on the login screen instead of failing silently.

**Fonts load from Google.** First load needs internet. Without it you get system fonts; everything still works.

## Keyboard shortcuts

`alt+d` dashboard · `alt+x` prescriptions · `alt+r` receive stock · `alt+i` inventory · `alt+b` dispense · `alt+h` bills · `alt+e` expiry · `alt+p` patients

## Building for deployment

```bash
npm run build      # → dist/
npm run preview
```

`dist/` is static files and can go on any host. The localStorage caveat above still applies: each machine gets its own separate records until you add a backend.

## Licence

MIT — see [LICENSE](LICENSE).
