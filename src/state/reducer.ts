/**
 * The single source of truth, as a pure reducer.
 *
 * Every mutation the app can make is one action here. Nothing in this file
 * awaits, touches storage, or knows what React is — which means the whole
 * behaviour of the app is testable by feeding it actions, and reusable by any
 * future platform build.
 */

import type {
  AuditEntry,
  Batch,
  Bill,
  Feature,
  Patient,
  Prescription,
  User,
} from "@/domain";
import { append as appendAudit, applyQuantityDeltas } from "@/domain";
import type { Preferences } from "@/data/repository";
import { DEFAULT_PREFERENCES } from "@/data/repository";

export interface AppState {
  readonly status: "loading" | "ready";
  readonly users: readonly User[];
  readonly currentUserId: string | null;
  readonly stock: readonly Batch[];
  readonly bills: readonly Bill[];
  readonly patients: readonly Patient[];
  readonly prescriptions: readonly Prescription[];
  readonly audit: readonly AuditEntry[];
  readonly prefs: Preferences;
  /**
   * Prescription the counter is currently filling. Set when a pharmacist hits
   * "Dispense" on the queue; the billing screen reads it, preloads the cart via
   * FEFO, and clears it once the bill is issued.
   */
  readonly fillingPrescriptionId: string | null;
  /** Screen the shell should switch to. Lets a screen hand off to another. */
  readonly pendingNavigation: Feature | null;
}

export const initialState: AppState = {
  status: "loading",
  users: [],
  currentUserId: null,
  stock: [],
  bills: [],
  patients: [],
  prescriptions: [],
  audit: [],
  prefs: DEFAULT_PREFERENCES,
  fillingPrescriptionId: null,
  pendingNavigation: null,
};

export type Action =
  | {
      type: "hydrated";
      payload: Omit<AppState, "status" | "fillingPrescriptionId" | "pendingNavigation">;
    }
  | { type: "session/set"; userId: string | null }
  | { type: "users/add"; user: User }
  | { type: "users/replace"; users: readonly User[] }
  | { type: "stock/set"; stock: readonly Batch[] }
  | { type: "stock/add"; batches: readonly Batch[] }
  | { type: "stock/remove"; batchId: string }
  | { type: "stock/applyDeltas"; deltas: ReadonlyMap<string, number> }
  | { type: "bills/add"; bill: Bill }
  | { type: "bills/replace"; bill: Bill }
  | { type: "patients/add"; patient: Patient }
  | { type: "rx/add"; prescription: Prescription }
  | { type: "rx/replace"; prescription: Prescription }
  | { type: "rx/startFilling"; prescriptionId: string | null }
  | { type: "nav/request"; feature: Feature | null }
  | { type: "audit/append"; entry: AuditEntry }
  | { type: "audit/set"; log: readonly AuditEntry[] }
  | { type: "prefs/set"; prefs: Partial<Preferences> }
  | {
      type: "data/replaceAll";
      payload: Pick<
        AppState,
        "users" | "stock" | "bills" | "patients" | "prescriptions" | "audit"
      >;
    }
  | { type: "data/wipeTransactional" };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrated":
      return { ...state, ...action.payload, status: "ready" };

    case "session/set":
      return { ...state, currentUserId: action.userId };

    case "users/add":
      return { ...state, users: [...state.users, action.user] };

    case "users/replace":
      return { ...state, users: action.users };

    case "stock/set":
      return { ...state, stock: action.stock };

    case "stock/add":
      return { ...state, stock: [...state.stock, ...action.batches] };

    case "stock/remove":
      return {
        ...state,
        stock: state.stock.filter((b) => b.id !== action.batchId),
      };

    case "stock/applyDeltas":
      return { ...state, stock: applyQuantityDeltas(state.stock, action.deltas) };

    case "bills/add":
      return { ...state, bills: [...state.bills, action.bill] };

    case "bills/replace":
      return {
        ...state,
        bills: state.bills.map((b) => (b.id === action.bill.id ? action.bill : b)),
      };

    case "patients/add":
      return { ...state, patients: [...state.patients, action.patient] };

    case "rx/add":
      return { ...state, prescriptions: [action.prescription, ...state.prescriptions] };

    case "rx/replace":
      return {
        ...state,
        prescriptions: state.prescriptions.map((rx) =>
          rx.id === action.prescription.id ? action.prescription : rx,
        ),
      };

    case "rx/startFilling":
      return { ...state, fillingPrescriptionId: action.prescriptionId };

    case "nav/request":
      return { ...state, pendingNavigation: action.feature };

    // Appends go through the reducer rather than being computed from a ref, so
    // two audit writes inside one action can't clobber each other.
    case "audit/append":
      return { ...state, audit: appendAudit(state.audit, action.entry) };

    case "audit/set":
      return { ...state, audit: action.log };

    case "prefs/set":
      return { ...state, prefs: { ...state.prefs, ...action.prefs } };

    case "data/replaceAll":
      return { ...state, ...action.payload };

    case "data/wipeTransactional":
      return {
        ...state,
        stock: [],
        bills: [],
        patients: [],
        prescriptions: [],
        fillingPrescriptionId: null,
      };

    default: {
      // Exhaustiveness check — adding an action without handling it fails to compile.
      const never: never = action;
      return never;
    }
  }
}

/* ------------------------------------------------------------ selectors */

export function currentUser(state: AppState): User | null {
  if (!state.currentUserId) return null;
  return state.users.find((u) => u.id === state.currentUserId) ?? null;
}
