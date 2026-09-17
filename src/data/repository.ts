/**
 * Persistence for the whole app.
 *
 * Two things this adds over the old `dbGet`/`dbSet` pair:
 *
 * 1. **A schema version and migrations.** The previous build wrote raw arrays
 *    under `rx:*` with no version marker, so any field rename would have
 *    silently corrupted a live pharmacy's records. `migrate()` upgrades old
 *    shapes on load.
 * 2. **Coalesced writes.** Every mutation used to serialise and write the full
 *    array synchronously. Writes are now debounced and de-duplicated per key,
 *    so adding ten batches in a row costs one write, not ten.
 */

import type {
  AuditEntry,
  Batch,
  Bill,
  Patient,
  Prescription,
  Snapshot,
  User,
} from "@/domain";
import { normaliseUsers } from "@/domain";
import { platform } from "@/platform";

export const SCHEMA_VERSION = 3;

export const KEYS = {
  version: "schema-version",
  users: "users",
  session: "session",
  stock: "stock",
  bills: "bills",
  patients: "patients",
  prescriptions: "prescriptions",
  audit: "audit",
  prefs: "prefs",
} as const;

/** Keys written by the pre-TypeScript build, read once during migration. */
const LEGACY_KEYS = {
  users: "rx:users",
  session: "rx:session",
  stock: "rx:stock",
  bills: "rx:bills",
} as const;

export interface Preferences {
  readonly theme: "light" | "dark" | "system";
  readonly density: "comfortable" | "compact";
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  density: "comfortable",
};

export interface PersistedState {
  readonly users: readonly User[];
  readonly stock: readonly Batch[] | null;
  readonly bills: readonly Bill[];
  readonly patients: readonly Patient[];
  readonly prescriptions: readonly Prescription[];
  readonly audit: readonly AuditEntry[];
  readonly sessionUserId: string | null;
  readonly prefs: Preferences;
}

/* ------------------------------------------------------------ primitives */

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await platform.store.get(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt value must not take the whole app down — fall back and let the
    // user restore from a backup.
    console.warn(`[apotheca] could not parse stored value for "${key}"`);
    return fallback;
  }
}

/* ---------------------------------------------------------- write queue */

const WRITE_DELAY_MS = 120;

const pending = new Map<string, unknown>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();
const listeners = new Set<(error: Error) => void>();

/** Subscribe to write failures (quota exceeded, etc.). */
export function onWriteError(fn: (error: Error) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function flush(): Promise<void> {
  flushTimer = null;
  const batch = [...pending.entries()];
  pending.clear();

  for (const [key, value] of batch) {
    try {
      await platform.store.set(key, JSON.stringify(value));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const fn of listeners) fn(error);
    }
  }
}

/** Queue a write. Repeated writes to the same key collapse into the last one. */
function queueWrite(key: string, value: unknown): void {
  pending.set(key, value);
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    inFlight = inFlight.then(flush);
  }, WRITE_DELAY_MS);
}

/** Force any queued writes out now — call before export or unload. */
export async function flushWrites(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
    inFlight = inFlight.then(flush);
  }
  await inFlight;
}

/* --------------------------------------------------------------- public */

export const saveUsers = (v: readonly User[]) => queueWrite(KEYS.users, v);
export const saveStock = (v: readonly Batch[]) => queueWrite(KEYS.stock, v);
export const saveBills = (v: readonly Bill[]) => queueWrite(KEYS.bills, v);
export const savePatients = (v: readonly Patient[]) => queueWrite(KEYS.patients, v);
export const savePrescriptions = (v: readonly Prescription[]) =>
  queueWrite(KEYS.prescriptions, v);
export const saveAudit = (v: readonly AuditEntry[]) => queueWrite(KEYS.audit, v);
export const savePrefs = (v: Preferences) => queueWrite(KEYS.prefs, v);

export async function saveSession(userId: string | null): Promise<void> {
  if (userId === null) await platform.store.delete(KEYS.session);
  else await platform.store.set(KEYS.session, JSON.stringify(userId));
}

export async function loadAll(): Promise<PersistedState> {
  await migrate();

  const [users, stock, bills, patients, prescriptions, audit, session, prefs] =
    await Promise.all([
      readJson<readonly User[]>(KEYS.users, []),
      readJson<readonly Batch[] | null>(KEYS.stock, null),
      readJson<readonly Bill[]>(KEYS.bills, []),
      readJson<readonly Patient[]>(KEYS.patients, []),
      readJson<readonly Prescription[]>(KEYS.prescriptions, []),
      readJson<readonly AuditEntry[]>(KEYS.audit, []),
      readJson<string | null>(KEYS.session, null),
      readJson<Preferences>(KEYS.prefs, DEFAULT_PREFERENCES),
    ]);

  // Accounts from older builds lack Staff IDs and other newer fields.
  const fixedUsers = normaliseUsers(users);
  if (fixedUsers !== users) saveUsers(fixedUsers);

  return {
    users: fixedUsers,
    stock,
    bills,
    patients,
    prescriptions,
    audit,
    sessionUserId: session,
    prefs: { ...DEFAULT_PREFERENCES, ...prefs },
  };
}

export async function replaceAll(snapshot: Snapshot): Promise<void> {
  saveUsers(snapshot.users);
  saveStock(snapshot.stock);
  saveBills(snapshot.bills);
  savePatients(snapshot.patients);
  savePrescriptions(snapshot.prescriptions ?? []);
  saveAudit(snapshot.audit);
  await flushWrites();
}

export async function wipeTransactionalData(): Promise<void> {
  saveStock([]);
  saveBills([]);
  savePatients([]);
  savePrescriptions([]);
  await flushWrites();
}

/* ------------------------------------------------------------ migration */

interface LegacyBatch extends Omit<Batch, "id"> {
  id: string;
}

interface LegacyBill {
  id: string;
  no: string;
  at: string;
  patient?: string;
  patientId?: string;
  doctor?: string;
  pay?: string;
  payRef?: string;
  by?: string;
  pharmacy?: string;
  lines?: Array<Record<string, unknown>>;
  sub?: number;
  gstTotal?: number;
  discPct?: number;
  discAmt?: number;
  net?: number;
}

interface LegacyUser {
  id: string;
  roleId?: string;
  name: string;
  email: string;
  pharmacy: string;
  role: string;
  salt: string;
  pass: string;
  q: string;
  ans: string;
  createdAt: string;
}

/**
 * Upgrade `rx:*` records written by the JavaScript build. Runs once; after it
 * completes the version marker stops it happening again.
 */
async function migrate(): Promise<void> {
  const current = await readJson<number>(KEYS.version, 0);
  if (current >= SCHEMA_VERSION) return;

  if (current < 2) {
    const legacyUsers = await readJson<LegacyUser[] | null>(LEGACY_KEYS.users, null);
    const legacyStock = await readJson<LegacyBatch[] | null>(LEGACY_KEYS.stock, null);
    const legacyBills = await readJson<LegacyBill[] | null>(LEGACY_KEYS.bills, null);
    const legacySession = await readJson<string | null>(LEGACY_KEYS.session, null);

    if (legacyUsers?.length) {
      await platform.store.set(
        KEYS.users,
        JSON.stringify(
          legacyUsers.map((u) => ({
            id: u.id,
            roleId: u.roleId ?? "",
            name: u.name,
            email: u.email,
            pharmacy: u.pharmacy,
            role: u.role === "Admin" ? "Chief Pharmacist" : u.role,
            salt: u.salt,
            passwordHash: u.pass,
            securityQuestion: u.q,
            securityAnswerHash: u.ans,
            createdAt: u.createdAt,
            active: true,
          })),
        ),
      );
    }

    if (legacyStock) {
      // Batch shape is unchanged apart from field defaults.
      await platform.store.set(
        KEYS.stock,
        JSON.stringify(
          legacyStock.map((b) => ({ ...b, cost: b.cost ?? 0, reorder: b.reorder ?? 0 })),
        ),
      );
    }

    if (legacyBills?.length) {
      await platform.store.set(
        KEYS.bills,
        JSON.stringify(
          legacyBills.map((b) => ({
            id: b.id,
            no: b.no,
            at: b.at,
            patientName: b.patient ?? "",
            patientId: b.patientId ?? "",
            doctor: b.doctor ?? "",
            pay: b.pay ?? "Cash",
            payRef: b.payRef ?? "",
            byUserId: "",
            byName: b.by ?? "",
            pharmacy: b.pharmacy ?? "",
            lines: (b.lines ?? []).map((l) => ({
              // Old lines keyed the batch as `id`; the field is `batchId` now.
              batchId: (l.id as string) ?? "",
              name: l.name ?? "",
              brand: l.brand ?? "",
              form: l.form ?? "Tablet",
              strength: l.strength ?? "",
              batchNo: l.batchNo ?? "",
              expiry: l.expiry ?? "",
              mrp: Number(l.mrp) || 0,
              gst: Number(l.gst) || 0,
              qty: Number(l.qty) || 0,
            })),
            taxable: b.sub ?? 0,
            gstTotal: b.gstTotal ?? 0,
            discountPct: b.discPct ?? 0,
            discountAmt: b.discAmt ?? 0,
            net: b.net ?? 0,
            status: "issued",
          })),
        ),
      );
    }

    if (legacySession) {
      await platform.store.set(KEYS.session, JSON.stringify(legacySession));
    }
  }

  if (current < 3) {
    // v3 introduces e-prescriptions. Nothing to convert — installs upgrading
    // from v2 simply start with an empty prescription list.
    const existing = await platform.store.get(KEYS.prescriptions);
    if (existing === null) await platform.store.set(KEYS.prescriptions, "[]");
  }

  await platform.store.set(KEYS.version, JSON.stringify(SCHEMA_VERSION));
}
