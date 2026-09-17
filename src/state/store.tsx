/**
 * Store provider.
 *
 * Splits into three contexts on purpose:
 *   - `StateContext`   changes on every mutation
 *   - `ActionsContext` is stable for the app's lifetime
 *   - `DerivedContext` holds memoised indexes, recomputed only when inputs change
 *
 * Components that only dispatch (most forms and buttons) subscribe to the
 * stable context and never re-render when unrelated state moves.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import {
  applyQuantityDeltas,
  buildPrescription,
  buildStockIndex,
  canDo,
  canManage,
  findByHandle,
  normaliseUsers,
  issueStaffId,
  issueTemporaryPassword,
  makeEntry,
  billStockDeltas,
  markCancelled,
  markDispensed,
  markReturned,
  generatePatientId,
  randomId,
  seedStock,
  validateNewStaff,
  type AdjustReason,
  type AuditAction,
  type AuditEntry,
  type Batch,
  type Bill,
  type Feature,
  type IssuedCredentials,
  type NewStaffInput,
  type Patient,
  type Prescription,
  type PrescriptionDraft,
  type PrescriptionItem,
  type RoleName,
  type Snapshot,
  type StockIndex,
  type User,
} from "@/domain";
import { platform } from "@/platform";
import {
  DEFAULT_PREFERENCES,
  SCHEMA_VERSION,
  flushWrites,
  loadAll,
  onWriteError,
  replaceAll,
  saveAudit,
  saveBills,
  savePatients,
  savePrefs,
  savePrescriptions,
  saveSession,
  saveStock,
  saveUsers,
  wipeTransactionalData,
  type Preferences,
} from "@/data/repository";

import { currentUser as selectCurrentUser, initialState, reducer, type AppState } from "./reducer";

/* --------------------------------------------------------------- types */

/** First-run only: creates the single self-service Chief Pharmacist account. */
export interface BootstrapInput {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly pharmacy: string;
  readonly password: string;
  readonly securityQuestion: string;
  readonly securityAnswer: string;
}

/** `null` means success; a string is the message to show the user. */
export type Outcome = string | null;

export interface Actions {
  bootstrap(input: BootstrapInput): Promise<Outcome>;
  /** Sign in with a Staff ID or an email address. */
  login(handle: string, password: string): Promise<Outcome>;
  logout(): Promise<void>;
  recoverPassword(userId: string, answer: string, newPassword: string): Promise<Outcome>;
  /** The signed-in user replacing their own password. */
  changeOwnPassword(currentPassword: string, newPassword: string): Promise<Outcome>;
  /** Set or replace your own recovery question. */
  setSecurityQuestion(question: string, answer: string): Promise<Outcome>;

  /* --- administrator only --- */
  provisionStaff(input: NewStaffInput): Promise<IssuedCredentials | string>;
  resetStaffPassword(userId: string): Promise<IssuedCredentials | string>;
  setStaffActive(userId: string, active: boolean, reason: string): Promise<Outcome>;
  changeStaffRole(userId: string, role: RoleName): Promise<Outcome>;

  receiveStock(batches: readonly Batch[]): Promise<void>;
  adjustQty(batchId: string, delta: number, reason: AdjustReason, note?: string): Promise<void>;
  deleteBatch(batchId: string, reason: string): Promise<void>;
  writeOffExpired(batchIds: readonly string[]): Promise<void>;

  issueBill(bill: Bill): Promise<void>;
  returnBill(billId: string, reason: string): Promise<Outcome>;

  registerPatient(input: Omit<Patient, "id" | "createdAt">): Promise<Patient>;

  writePrescription(
    draft: PrescriptionDraft,
    items: readonly PrescriptionItem[],
  ): Promise<Prescription>;
  cancelPrescription(prescriptionId: string, reason: string): Promise<Outcome>;
  /** Send a prescription to the billing counter and navigate there. */
  startFilling(prescriptionId: string): void;
  clearFilling(): void;
  /** Ask the shell to switch screens. Cleared once the shell consumes it. */
  navigate(feature: Feature | null): void;

  exportSnapshot(): Promise<void>;
  exportCsv(filename: string, contents: string): Promise<void>;
  importSnapshot(): Promise<Outcome>;
  wipeData(): Promise<void>;

  setPrefs(prefs: Partial<Preferences>): void;
  log(action: AuditAction, summary: string, meta?: AuditEntry["meta"]): void;
}

export interface Derived {
  readonly user: User | null;
  readonly stockIndex: StockIndex;
}

const StateContext = createContext<AppState | null>(null);
const ActionsContext = createContext<Actions | null>(null);
const DerivedContext = createContext<Derived | null>(null);

/* ------------------------------------------------------------ provider */

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Actions need to read the latest state without being rebuilt on every
  // change, which would defeat the point of a stable actions context.
  const stateRef = useRef(state);
  stateRef.current = state;

  /* ---- hydrate once ---- */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const loaded = await loadAll();
      if (cancelled) return;

      // First run: plant the demo shelf so the app isn't an empty box.
      let stock = loaded.stock;
      if (stock === null) {
        stock = seedStock();
        saveStock(stock);
      }

      const session =
        loaded.sessionUserId &&
        loaded.users.some((u) => u.id === loaded.sessionUserId)
          ? loaded.sessionUserId
          : null;

      dispatch({
        type: "hydrated",
        payload: {
          users: loaded.users,
          stock,
          bills: loaded.bills,
          patients: loaded.patients,
          prescriptions: loaded.prescriptions,
          audit: loaded.audit,
          currentUserId: session,
          prefs: loaded.prefs,
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- surface storage failures instead of losing writes silently ---- */
  useEffect(
    () =>
      onWriteError((error) => {
        console.error("[apotheca] write failed", error);
        if (typeof window !== "undefined") {
          window.setTimeout(() => window.alert(error.message), 0);
        }
      }),
    [],
  );

  /* ---- make sure queued writes land before the tab closes ---- */
  useEffect(() => {
    const handler = () => void flushWrites();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  /* ---- persist the audit log from state ----
     The log is appended through the reducer, so this effect is the single place
     that writes it. Doing it here means two appends inside one action both
     survive; computing the next log from a ref would have lost the first. */
  useEffect(() => {
    if (state.status !== "ready") return;
    saveAudit(state.audit);
  }, [state.audit, state.status]);

  /* ---- audit helper, shared by every action ---- */
  const appendAudit = useCallback(
    (action: AuditAction, summary: string, meta?: AuditEntry["meta"]) => {
      const actor = selectCurrentUser(stateRef.current);
      dispatch({ type: "audit/append", entry: makeEntry(actor, action, summary, meta) });
    },
    [],
  );

  const actions = useMemo<Actions>(() => {
    /** Audit against an explicit actor — used before the session is set. */
    const auditAs = (
      actor: Pick<User, "id" | "name"> | null,
      action: AuditAction,
      summary: string,
    ) => {
      dispatch({ type: "audit/append", entry: makeEntry(actor, action, summary) });
    };

    const persistStock = (stock: readonly Batch[]) => saveStock(stock);

    return {
      /* ------------------------------------------------------------ auth */

      /**
       * First run only. Creates the Chief Pharmacist who will then issue every
       * other account. Refuses to run a second time.
       */
      async bootstrap(input) {
        const { users } = stateRef.current;
        if (users.length > 0)
          return "This pharmacy is already set up. Ask an administrator for an account.";
        if (!platform.crypto.available)
          return "Password hashing is unavailable. Open the app on localhost or over HTTPS.";

        const salt = platform.crypto.randomSalt();
        const [passwordHash, securityAnswerHash] = await Promise.all([
          platform.crypto.hash(input.password, salt),
          platform.crypto.hash(input.securityAnswer.trim().toLowerCase(), salt),
        ]);

        const user: User = {
          id: randomId(),
          staffId: issueStaffId("Chief Pharmacist", users),
          name: input.name.trim(),
          email: input.email.trim(),
          phone: input.phone.trim(),
          department: "Pharmacy",
          pharmacy: input.pharmacy.trim() || "Hospital Pharmacy",
          role: "Chief Pharmacist",
          salt,
          passwordHash,
          securityQuestion: input.securityQuestion,
          securityAnswerHash,
          mustChangePassword: false,
          active: true,
          createdAt: new Date().toISOString(),
          createdBy: "bootstrap",
          lastLoginAt: new Date().toISOString(),
        };

        dispatch({ type: "users/replace", users: [user] });
        saveUsers([user]);
        dispatch({ type: "session/set", userId: user.id });
        await saveSession(user.id);
        auditAs(
          user,
          "user.provision",
          `${user.name} set up the pharmacy as Chief Pharmacist (${user.staffId})`,
        );
        return null;
      },

      async login(handle, password) {
        const user = findByHandle(stateRef.current.users, handle);
        if (!user) return "No account uses that Staff ID or email.";
        if (!user.active)
          return "That account has been deactivated. Speak to your administrator.";
        if (!platform.crypto.available)
          return "Password hashing is unavailable. Open the app on localhost or over HTTPS.";

        const hash = await platform.crypto.hash(password, user.salt);
        if (hash !== user.passwordHash) {
          // Failed attempts are recorded — a run of them against one Staff ID is
          // exactly what an administrator needs to see.
          auditAs(
            { id: user.id, name: user.name },
            "user.login_failed",
            `Failed sign-in for ${user.staffId}`,
          );
          return "Password doesn't match.";
        }

        const stamped = { ...user, lastLoginAt: new Date().toISOString() };
        const next = stateRef.current.users.map((u) =>
          u.id === user.id ? stamped : u,
        );
        dispatch({ type: "users/replace", users: next });
        saveUsers(next);

        dispatch({ type: "session/set", userId: user.id });
        await saveSession(user.id);
        auditAs(user, "user.login", `${user.name} signed in (${user.staffId})`);
        return null;
      },

      async logout() {
        const user = selectCurrentUser(stateRef.current);
        if (user) auditAs(user, "user.logout", `${user.name} signed out`);
        dispatch({ type: "session/set", userId: null });
        await saveSession(null);
        await flushWrites();
      },

      async recoverPassword(userId, answer, newPassword) {
        const { users } = stateRef.current;
        const user = users.find((u) => u.id === userId);
        if (!user) return "Account not found.";

        const attempt = await platform.crypto.hash(
          answer.trim().toLowerCase(),
          user.salt,
        );
        if (attempt !== user.securityAnswerHash) return "Answer doesn't match.";

        // Rotate the salt too, so the old hash is worthless afterwards.
        const salt = platform.crypto.randomSalt();
        const [passwordHash, securityAnswerHash] = await Promise.all([
          platform.crypto.hash(newPassword, salt),
          platform.crypto.hash(answer.trim().toLowerCase(), salt),
        ]);

        const next = users.map((u) =>
          u.id === userId
            ? { ...u, salt, passwordHash, securityAnswerHash, mustChangePassword: false }
            : u,
        );
        dispatch({ type: "users/replace", users: next });
        saveUsers(next);
        auditAs(user, "user.password_changed", `${user.name} recovered their own password`);
        return null;
      },

      /** Used by the forced first-sign-in change, and from Settings later. */
      async changeOwnPassword(currentPassword, newPassword) {
        const me = selectCurrentUser(stateRef.current);
        if (!me) return "You must be signed in.";

        const current = await platform.crypto.hash(currentPassword, me.salt);
        if (current !== me.passwordHash) return "Your current password doesn't match.";
        if (currentPassword === newPassword)
          return "Choose a password different from the issued one.";

        // Keep the salt as-is: rotating it here would invalidate the stored
        // security-answer hash, which is set separately.
        const passwordHash = await platform.crypto.hash(newPassword, me.salt);

        const next = stateRef.current.users.map((u) =>
          u.id === me.id ? { ...u, passwordHash, mustChangePassword: false } : u,
        );
        dispatch({ type: "users/replace", users: next });
        saveUsers(next);
        appendAudit("user.password_changed", `${me.name} changed their own password`);
        return null;
      },

      async setSecurityQuestion(question, answer) {
        const me = selectCurrentUser(stateRef.current);
        if (!me) return "You must be signed in.";
        if (!answer.trim()) return "Enter an answer.";

        const securityAnswerHash = await platform.crypto.hash(
          answer.trim().toLowerCase(),
          me.salt,
        );
        const next = stateRef.current.users.map((u) =>
          u.id === me.id ? { ...u, securityQuestion: question, securityAnswerHash } : u,
        );
        dispatch({ type: "users/replace", users: next });
        saveUsers(next);
        return null;
      },

      /* -------------------------------------------- administrator only */

      async provisionStaff(input) {
        const admin = selectCurrentUser(stateRef.current);
        if (!admin || !canDo(admin, "manageStaff"))
          return "Only an administrator can issue accounts.";
        if (!platform.crypto.available)
          return "Password hashing is unavailable on this origin.";

        const { users } = stateRef.current;
        const check = validateNewStaff(input, users);
        if (!check.ok) return check.message;

        const temporaryPassword = issueTemporaryPassword();
        const salt = platform.crypto.randomSalt();
        const passwordHash = await platform.crypto.hash(temporaryPassword, salt);
        // No security question yet — the holder sets one when they take over
        // the account. An unanswerable hash is safer than a guessable default.
        const securityAnswerHash = await platform.crypto.hash(randomId(), salt);

        const user: User = {
          id: randomId(),
          staffId: issueStaffId(input.role, users),
          name: input.name.trim(),
          email: input.email.trim(),
          phone: input.phone.trim(),
          department: input.department.trim(),
          pharmacy: admin.pharmacy,
          role: input.role,
          salt,
          passwordHash,
          securityQuestion: "",
          securityAnswerHash,
          mustChangePassword: true,
          active: true,
          createdAt: new Date().toISOString(),
          createdBy: admin.id,
          lastLoginAt: null,
        };

        const next = [...users, user];
        dispatch({ type: "users/add", user });
        saveUsers(next);
        appendAudit(
          "user.provision",
          `Issued ${user.staffId} to ${user.name} as ${user.role}`,
          { staffId: user.staffId, role: user.role },
        );

        return { user, staffId: user.staffId, temporaryPassword };
      },

      async resetStaffPassword(userId) {
        const admin = selectCurrentUser(stateRef.current);
        if (!admin || !canDo(admin, "manageStaff"))
          return "Only an administrator can reset passwords.";

        const { users } = stateRef.current;
        const target = users.find((u) => u.id === userId);
        if (!target) return "Account not found.";
        if (!canManage(admin, target))
          return "You can only reset accounts below your own level.";

        const temporaryPassword = issueTemporaryPassword();
        const salt = platform.crypto.randomSalt();
        const passwordHash = await platform.crypto.hash(temporaryPassword, salt);

        const updated: User = {
          ...target,
          salt,
          passwordHash,
          mustChangePassword: true,
        };
        const next = users.map((u) => (u.id === userId ? updated : u));
        dispatch({ type: "users/replace", users: next });
        saveUsers(next);
        appendAudit(
          "user.password_reset",
          `Password reset for ${target.name} (${target.staffId})`,
          { staffId: target.staffId },
        );

        return { user: updated, staffId: updated.staffId, temporaryPassword };
      },

      async setStaffActive(userId, active, reason) {
        const admin = selectCurrentUser(stateRef.current);
        if (!admin || !canDo(admin, "manageStaff"))
          return "Only an administrator can change account status.";

        const { users } = stateRef.current;
        const target = users.find((u) => u.id === userId);
        if (!target) return "Account not found.";
        if (!canManage(admin, target))
          return "You can only change accounts below your own level.";

        const next = users.map((u) => (u.id === userId ? { ...u, active } : u));
        dispatch({ type: "users/replace", users: next });
        saveUsers(next);
        appendAudit(
          active ? "user.reactivate" : "user.deactivate",
          `${active ? "Reactivated" : "Deactivated"} ${target.name} (${target.staffId})${reason ? ` — ${reason}` : ""}`,
          { staffId: target.staffId },
        );
        return null;
      },

      async changeStaffRole(userId, role) {
        const admin = selectCurrentUser(stateRef.current);
        if (!admin || !canDo(admin, "manageStaff"))
          return "Only an administrator can change roles.";

        const { users } = stateRef.current;
        const target = users.find((u) => u.id === userId);
        if (!target) return "Account not found.";
        if (!canManage(admin, target))
          return "You can only change accounts below your own level.";
        if (target.role === role) return null;

        // The Staff ID prefix encodes the role, so it is reissued to match.
        const staffId = issueStaffId(role, users);
        const next = users.map((u) =>
          u.id === userId ? { ...u, role, staffId } : u,
        );
        dispatch({ type: "users/replace", users: next });
        saveUsers(next);
        appendAudit(
          "user.role_change",
          `${target.name}: ${target.role} → ${role}, new ID ${staffId}`,
          { from: target.role, to: role, staffId },
        );
        return null;
      },

      /* ----------------------------------------------------------- stock */

      async receiveStock(batches) {
        if (batches.length === 0) return;
        const next = [...stateRef.current.stock, ...batches];
        dispatch({ type: "stock/set", stock: next });
        persistStock(next);

        const units = batches.reduce((n, b) => n + b.qty, 0);
        appendAudit(
          "stock.receive",
          batches.length === 1 && batches[0]
            ? `Received ${batches[0].qty} × ${batches[0].name} ${batches[0].strength} (batch ${batches[0].batchNo})`
            : `Received ${batches.length} batches, ${units} units total`,
          { batches: batches.length, units },
        );
      },

      async adjustQty(batchId, delta, reason, note) {
        const batch = stateRef.current.stock.find((b) => b.id === batchId);
        if (!batch || delta === 0) return;

        // Clamp at zero, and log what was *actually* applied rather than what
        // was asked for — "-5" on a batch of 3 is a -3 movement.
        const applied = Math.max(0, batch.qty + delta) - batch.qty;
        if (applied === 0) return;

        const next = stateRef.current.stock.map((b) =>
          b.id === batchId ? { ...b, qty: b.qty + applied } : b,
        );
        dispatch({ type: "stock/set", stock: next });
        persistStock(next);

        appendAudit(
          "stock.adjust",
          `${applied > 0 ? "+" : ""}${applied} ${batch.name} ${batch.strength} (batch ${batch.batchNo}) — ${reason}${note ? `: ${note}` : ""}`,
          { batchId, delta: applied, reason },
        );
      },

      async deleteBatch(batchId, reason) {
        const batch = stateRef.current.stock.find((b) => b.id === batchId);
        if (!batch) return;

        const next = stateRef.current.stock.filter((b) => b.id !== batchId);
        dispatch({ type: "stock/set", stock: next });
        persistStock(next);
        appendAudit(
          "stock.delete",
          `Deleted ${batch.name} ${batch.strength} batch ${batch.batchNo} (${batch.qty} units) — ${reason}`,
          { batchId, qty: batch.qty, reason },
        );
      },

      async writeOffExpired(batchIds) {
        if (batchIds.length === 0) return;
        const ids = new Set(batchIds);
        const removed = stateRef.current.stock.filter((b) => ids.has(b.id));
        const value = removed.reduce((n, b) => n + b.qty * (b.cost || b.mrp), 0);

        const next = stateRef.current.stock.filter((b) => !ids.has(b.id));
        dispatch({ type: "stock/set", stock: next });
        persistStock(next);

        appendAudit(
          "stock.writeoff",
          `Wrote off ${removed.length} expired batch${removed.length === 1 ? "" : "es"} — loss ₹${value.toFixed(2)}`,
          { batches: removed.length, value: Number(value.toFixed(2)) },
        );
      },

      /* --------------------------------------------------------- billing */

      async issueBill(bill) {
        const deltas = billStockDeltas(bill, "issue");
        const nextBills = [...stateRef.current.bills, bill];
        const nextStock = applyQuantityDeltas(stateRef.current.stock, deltas);

        dispatch({ type: "bills/add", bill });
        dispatch({ type: "stock/set", stock: nextStock });
        saveBills(nextBills);
        persistStock(nextStock);

        // If this bill came from a prescription, close that prescription out
        // against it so the doctor can see it was filled, and by whom.
        const fillingId = stateRef.current.fillingPrescriptionId;
        const actor = selectCurrentUser(stateRef.current);
        if (fillingId && actor) {
          const rx = stateRef.current.prescriptions.find((p) => p.id === fillingId);
          if (rx && rx.status === "open") {
            const dispensed = markDispensed(rx, actor, bill.no);
            const nextRx = stateRef.current.prescriptions.map((p) =>
              p.id === fillingId ? dispensed : p,
            );
            dispatch({ type: "rx/replace", prescription: dispensed });
            savePrescriptions(nextRx);
            appendAudit(
              "rx.dispense",
              `${rx.id} dispensed against bill ${bill.no} for ${rx.patientName}`,
              { rx: rx.id, billNo: bill.no },
            );
          }
          dispatch({ type: "rx/startFilling", prescriptionId: null });
        }

        appendAudit(
          "bill.issue",
          `Bill ${bill.no} — ${bill.patientName}, ${bill.lines.length} item${bill.lines.length === 1 ? "" : "s"}, ₹${bill.net.toFixed(2)}`,
          { billNo: bill.no, net: Number(bill.net.toFixed(2)) },
        );
      },

      async returnBill(billId, reason) {
        const user = selectCurrentUser(stateRef.current);
        if (!user) return "You must be signed in.";

        const bill = stateRef.current.bills.find((b) => b.id === billId);
        if (!bill) return "Bill not found.";
        if (bill.status === "returned") return "That bill was already returned.";

        const returned = markReturned(bill, user, reason);
        const deltas = billStockDeltas(bill, "return");
        const nextBills = stateRef.current.bills.map((b) =>
          b.id === billId ? returned : b,
        );
        const nextStock = applyQuantityDeltas(stateRef.current.stock, deltas);

        dispatch({ type: "bills/replace", bill: returned });
        dispatch({ type: "stock/set", stock: nextStock });
        saveBills(nextBills);
        persistStock(nextStock);

        appendAudit(
          "bill.return",
          `Returned bill ${bill.no} (₹${bill.net.toFixed(2)}) — ${reason}`,
          { billNo: bill.no, net: Number(bill.net.toFixed(2)) },
        );
        return null;
      },

      /* -------------------------------------------------------- patients */

      async registerPatient(input) {
        const patient: Patient = {
          ...input,
          id: generatePatientId(stateRef.current.patients),
          createdAt: new Date().toISOString(),
        };
        const next = [...stateRef.current.patients, patient];
        dispatch({ type: "patients/add", patient });
        savePatients(next);
        appendAudit("patient.create", `Registered ${patient.name} as ${patient.id}`);
        return patient;
      },

      /* --------------------------------------------------- prescriptions */

      async writePrescription(draft, items) {
        const doctor = selectCurrentUser(stateRef.current);
        if (!doctor) throw new Error("Not signed in.");

        const prescription = buildPrescription(
          draft,
          items,
          doctor,
          stateRef.current.prescriptions,
        );
        const next = [prescription, ...stateRef.current.prescriptions];

        dispatch({ type: "rx/add", prescription });
        savePrescriptions(next);
        appendAudit(
          "rx.write",
          `${prescription.id} for ${prescription.patientName} — ${prescription.items.length} medicine${
            prescription.items.length === 1 ? "" : "s"
          }`,
          { rx: prescription.id, items: prescription.items.length },
        );
        return prescription;
      },

      async cancelPrescription(prescriptionId, reason) {
        const rx = stateRef.current.prescriptions.find((p) => p.id === prescriptionId);
        if (!rx) return "Prescription not found.";
        if (rx.status === "dispensed")
          return "That prescription has already been dispensed.";
        if (rx.status === "cancelled") return "That prescription is already cancelled.";

        const cancelled = markCancelled(rx, reason);
        const next = stateRef.current.prescriptions.map((p) =>
          p.id === prescriptionId ? cancelled : p,
        );

        dispatch({ type: "rx/replace", prescription: cancelled });
        savePrescriptions(next);
        appendAudit("rx.cancel", `Cancelled ${rx.id} (${rx.patientName}) — ${reason}`, {
          rx: rx.id,
        });
        return null;
      },

      startFilling(prescriptionId) {
        dispatch({ type: "rx/startFilling", prescriptionId });
        dispatch({ type: "nav/request", feature: "billing" });
      },

      clearFilling() {
        dispatch({ type: "rx/startFilling", prescriptionId: null });
      },

      navigate(feature) {
        dispatch({ type: "nav/request", feature });
      },

      /* ------------------------------------------------------------ data */

      async exportSnapshot() {
        await flushWrites();
        const s = stateRef.current;
        const snapshot: Snapshot = {
          version: SCHEMA_VERSION,
          users: s.users,
          stock: s.stock,
          bills: s.bills,
          patients: s.patients,
          prescriptions: s.prescriptions,
          audit: s.audit,
          exportedAt: new Date().toISOString(),
        };
        const stamp = new Date().toISOString().slice(0, 10);
        await platform.files.save(
          `apotheca-backup-${stamp}.json`,
          JSON.stringify(snapshot, null, 2),
          "application/json",
        );
        appendAudit("data.export", "Full JSON backup downloaded");
      },

      async exportCsv(filename, contents) {
        await platform.files.save(filename, contents, "text/csv");
        appendAudit("data.export", `Exported ${filename}`);
      },

      async importSnapshot() {
        const text = await platform.files.open("application/json,.json");
        if (text === null) return "Import cancelled.";

        let snapshot: Partial<Snapshot>;
        try {
          snapshot = JSON.parse(text) as Partial<Snapshot>;
        } catch {
          return "That file isn't valid JSON.";
        }

        if (!Array.isArray(snapshot.stock) || !Array.isArray(snapshot.users))
          return "That file doesn't look like an Apotheca backup.";

        const payload = {
          users: normaliseUsers(snapshot.users ?? []),
          stock: snapshot.stock ?? [],
          bills: snapshot.bills ?? [],
          patients: snapshot.patients ?? [],
          prescriptions: snapshot.prescriptions ?? [],
          audit: snapshot.audit ?? [],
        };

        dispatch({ type: "data/replaceAll", payload });
        await replaceAll({
          version: SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          ...payload,
        });

        appendAudit(
          "data.import",
          `Restored backup — ${payload.stock.length} batches, ${payload.bills.length} bills, ${payload.users.length} accounts`,
        );
        return null;
      },

      async wipeData() {
        dispatch({ type: "data/wipeTransactional" });
        await wipeTransactionalData();
        appendAudit("data.wipe", "Stock, bills and patients cleared. Accounts kept.");
      },

      /* ------------------------------------------------------------ prefs */

      setPrefs(prefs) {
        const next = { ...stateRef.current.prefs, ...prefs };
        dispatch({ type: "prefs/set", prefs });
        savePrefs(next);
      },

      log(action, summary, meta) {
        appendAudit(action, summary, meta);
      },
    };
  }, [appendAudit]);

  /* ---- derived data, recomputed only when its inputs move ---- */
  const user = useMemo(() => selectCurrentUser(state), [state.users, state.currentUserId]);
  const stockIndex = useMemo(() => buildStockIndex(state.stock), [state.stock]);
  const derived = useMemo<Derived>(() => ({ user, stockIndex }), [user, stockIndex]);

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>
        <DerivedContext.Provider value={derived}>{children}</DerivedContext.Provider>
      </ActionsContext.Provider>
    </StateContext.Provider>
  );
}

/* --------------------------------------------------------------- hooks */

function required<T>(value: T | null, name: string): T {
  if (value === null)
    throw new Error(`${name} must be used inside <StoreProvider>.`);
  return value;
}

export const useAppState = (): AppState =>
  required(useContext(StateContext), "useAppState");

export const useActions = (): Actions =>
  required(useContext(ActionsContext), "useActions");

export const useDerived = (): Derived =>
  required(useContext(DerivedContext), "useDerived");

/** The signed-in user. Throws if called from a screen rendered while logged out. */
export function useCurrentUser(): User {
  const { user } = useDerived();
  if (!user) throw new Error("useCurrentUser called while signed out.");
  return user;
}

export const usePreferences = (): Preferences => useAppState().prefs;

export { DEFAULT_PREFERENCES };
export type { Preferences };
