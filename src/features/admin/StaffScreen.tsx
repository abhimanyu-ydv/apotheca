import { useMemo, useState } from "react";
import {
  Ban,
  Check,
  Copy,
  KeyRound,
  Printer,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";

import {
  FEATURES,
  ROLES,
  ROLE_LIST,
  canDo,
  canManage,
  credentialSlip,
  formatDate,
  formatDateTime,
  roleColour,
  type Feature,
  type IssuedCredentials,
  type NewStaffInput,
  type RoleDefinition,
  type RoleName,
  type User,
} from "@/domain";
import { useActions, useAppState, useCurrentUser } from "@/state/store";
import { DataTable, type Column } from "@/ui/DataTable";
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Grid,
  Input,
  Modal,
  Screen,
  SearchInput,
  Stat,
  Tag,
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { RolePicker } from "../auth/RolePicker";

const FEATURE_LABELS: Record<Feature, string> = {
  dashboard: "Dashboard",
  prescriptions: "Prescriptions",
  addStock: "Receive stock",
  inventory: "Inventory",
  billing: "Dispense & bill",
  bills: "Bill history",
  expiry: "Expiry desk",
  patients: "Patients",
  audit: "Audit log",
  staff: "Staff & access",
  settings: "Settings",
};

const ACTION_ROWS: ReadonlyArray<[string, keyof RoleDefinition["can"]]> = [
  ["Write a prescription", "writePrescription"],
  ["Fill a prescription", "fulfilPrescription"],
  ["Receive stock", "receiveStock"],
  ["Adjust quantities", "adjustStock"],
  ["Delete a batch", "deleteStock"],
  ["Write off expired", "writeOffExpired"],
  ["Return a bill", "returnBill"],
  ["See cost & margin", "viewCost"],
  ["Issue staff accounts", "manageStaff"],
  ["Export / import data", "exportData"],
];

/**
 * Staff & access — the administrator's core screen.
 *
 * There is no self-signup anywhere in the app, so this is the only place an
 * account can come into existence. Provisioning generates the Staff ID and a
 * one-time password, shows them exactly once, and forces the holder to replace
 * the password before they can do anything.
 */
export function StaffScreen() {
  const { users } = useAppState();
  const me = useCurrentUser();
  const actions = useActions();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [suspending, setSuspending] = useState<User | null>(null);
  const [editingRole, setEditingRole] = useState<User | null>(null);

  const mayManage = canDo(me, "manageStaff");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      `${u.staffId} ${u.name} ${u.email} ${u.role} ${u.department}`
        .toLowerCase()
        .includes(q),
    );
  }, [users, query]);

  const summary = useMemo(
    () => ({
      active: users.filter((u) => u.active).length,
      disabled: users.filter((u) => !u.active).length,
      pending: users.filter((u) => u.mustChangePassword && u.active).length,
    }),
    [users],
  );

  const columns: Column<User>[] = [
    {
      key: "staffId",
      header: "Staff ID",
      sortBy: (u) => u.staffId,
      render: (u) => (
        <>
          <div className="mono" style={{ fontWeight: 600, userSelect: "all" }}>
            {u.staffId}
          </div>
          {!u.active && <Tag tone="bad">Disabled</Tag>}
          {u.active && u.mustChangePassword && <Tag tone="warn">Temp password</Tag>}
        </>
      ),
    },
    {
      key: "name",
      header: "Name",
      sortBy: (u) => u.name,
      render: (u) => (
        <>
          <div style={{ fontWeight: 600 }}>
            {u.name}
            {u.id === me.id && (
              <span style={{ marginLeft: 8 }}>
                <Tag tone="ok">You</Tag>
              </span>
            )}
          </div>
          <div className="sub mono">{u.email}</div>
        </>
      ),
    },
    {
      key: "role",
      header: "Role",
      sortBy: (u) => ROLES[u.role].level,
      render: (u) => (
        <>
          <span className="tag" style={{ background: roleColour(u.role), color: "#fff" }}>
            {u.role}
          </span>
          {u.department && <div className="sub">{u.department}</div>}
        </>
      ),
    },
    {
      key: "lastLogin",
      header: "Last sign-in",
      sortBy: (u) => u.lastLoginAt ?? "",
      render: (u) =>
        u.lastLoginAt ? (
          <span className="mono" style={{ fontSize: 11 }}>
            {formatDateTime(u.lastLoginAt)}
          </span>
        ) : (
          <span className="sub">Never</span>
        ),
    },
    {
      key: "createdAt",
      header: "Issued",
      sortBy: (u) => u.createdAt,
      render: (u) => (
        <span className="mono" style={{ fontSize: 11 }}>
          {formatDate(u.createdAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (u) => {
        const manageable = canManage(me, u);
        return (
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <Button
              size="sm"
              icon={KeyRound}
              disabled={!manageable}
              title={manageable ? "Issue a new temporary password" : "Below your level only"}
              onClick={() => setResetting(u)}
            >
              Reset
            </Button>
            <Button
              size="sm"
              disabled={!manageable}
              title="Change this person's role"
              onClick={() => setEditingRole(u)}
            >
              Role
            </Button>
            <Button
              size="sm"
              variant={u.active ? "danger" : "default"}
              icon={u.active ? Ban : Check}
              disabled={!manageable}
              aria-label={u.active ? "Disable account" : "Enable account"}
              onClick={() => setSuspending(u)}
            />
          </div>
        );
      },
    },
  ];

  return (
    <Screen
      eyebrow="Administration"
      title="Staff & access"
      actions={
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Staff ID, name, email, role…"
            minWidth={260}
          />
          <Button
            variant="primary"
            icon={UserPlus}
            disabled={!mayManage}
            onClick={() => setIssuing(true)}
          >
            Issue an account
          </Button>
        </>
      }
    >
      <Banner tone="info" icon={ShieldCheck}>
        Accounts cannot be self-created. You issue a Staff ID and a one-time
        password here; the holder is forced to replace that password the first
        time they sign in.
      </Banner>

      <Grid cols={4}>
        <Stat label="Active accounts" value={summary.active} />
        <Stat
          label="On temporary password"
          value={summary.pending}
          tone={summary.pending ? "warn" : "ok"}
        />
        <Stat label="Disabled" value={summary.disabled} tone={summary.disabled ? "bad" : "neutral"} />
        <Stat label="Roles in use" value={new Set(users.map((u) => u.role)).size} />
      </Grid>

      <Card padded={false}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(u) => u.id}
          rowClass={(u) => (u.active ? undefined : "danger")}
          initialSort={{ key: "role", dir: "desc" }}
          emptyIcon={Users}
          emptyMessage="No accounts match that search."
        />
      </Card>

      <Card title="What each role can reach" icon={ShieldCheck}>
        <p className="sub" style={{ margin: 0 }}>
          Enforced, not advisory. Each role gets its own console — the navigation,
          the home screen and the available actions all differ.
        </p>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Screen</th>
                {ROLE_LIST.map((r) => (
                  <th key={r.name} style={{ textAlign: "center" }}>
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((feature) => (
                <tr key={feature}>
                  <td style={{ fontWeight: 500 }}>{FEATURE_LABELS[feature]}</td>
                  {ROLE_LIST.map((r) => (
                    <td key={r.name} style={{ textAlign: "center" }}>
                      <Mark on={r.view.has(feature)} />
                    </td>
                  ))}
                </tr>
              ))}
              {ACTION_ROWS.map(([label, key]) => (
                <tr key={key}>
                  <td style={{ fontWeight: 500, color: "var(--muted)" }}>{label}</td>
                  {ROLE_LIST.map((r) => (
                    <td key={r.name} style={{ textAlign: "center" }}>
                      <Mark on={r.can[key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {issuing && (
        <IssueAccountDialog
          onClose={() => setIssuing(false)}
          onSubmit={async (input) => {
            const result = await actions.provisionStaff(input);
            if (typeof result === "string") {
              toast.error(result);
              return false;
            }
            setIssuing(false);
            setIssued(result);
            toast.ok(`${result.staffId} issued to ${result.user.name}.`);
            return true;
          }}
        />
      )}

      {issued && <CredentialsDialog issued={issued} onClose={() => setIssued(null)} />}

      {resetting && (
        <ConfirmDialog
          title={`Reset password — ${resetting.name}`}
          confirmLabel="Issue new password"
          body={
            <div>
              <p style={{ marginTop: 0 }}>
                This invalidates {resetting.name}'s current password immediately
                and issues a new one-time password. They'll be forced to choose
                their own on the next sign-in.
              </p>
              <div className="sub">
                {resetting.staffId} · {resetting.role}
                {resetting.department && ` · ${resetting.department}`}
              </div>
            </div>
          }
          onCancel={() => setResetting(null)}
          onConfirm={async () => {
            const result = await actions.resetStaffPassword(resetting.id);
            setResetting(null);
            if (typeof result === "string") toast.error(result);
            else {
              setIssued(result);
              toast.warn(`New password issued for ${result.user.name}.`);
            }
          }}
        />
      )}

      {suspending && (
        <ConfirmDialog
          title={
            suspending.active
              ? `Disable ${suspending.name}`
              : `Re-enable ${suspending.name}`
          }
          confirmLabel={suspending.active ? "Disable account" : "Re-enable account"}
          requireReason={suspending.active}
          body={
            <p style={{ marginTop: 0 }}>
              {suspending.active ? (
                <>
                  {suspending.name} ({suspending.staffId}) will not be able to
                  sign in. Their history and audit trail are kept.
                </>
              ) : (
                <>
                  {suspending.name} will be able to sign in again with their
                  existing password.
                </>
              )}
            </p>
          }
          onCancel={() => setSuspending(null)}
          onConfirm={async (reason) => {
            const problem = await actions.setStaffActive(
              suspending.id,
              !suspending.active,
              reason,
            );
            if (problem) toast.error(problem);
            else
              toast.warn(
                `${suspending.name} ${suspending.active ? "disabled" : "re-enabled"}.`,
              );
            setSuspending(null);
          }}
        />
      )}

      {editingRole && (
        <ChangeRoleDialog
          user={editingRole}
          onClose={() => setEditingRole(null)}
          onSubmit={async (role) => {
            const problem = await actions.changeStaffRole(editingRole.id, role);
            if (problem) toast.error(problem);
            else toast.ok(`${editingRole.name} is now ${role}. Staff ID reissued.`);
            setEditingRole(null);
          }}
        />
      )}
    </Screen>
  );
}

const Mark = ({ on }: { on: boolean }) =>
  on ? (
    <span style={{ color: "var(--teal)", fontWeight: 600 }}>✓</span>
  ) : (
    <span style={{ color: "var(--muted)" }}>·</span>
  );

/* ---------------------------------------------------------- provisioning */

function IssueAccountDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: NewStaffInput) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState<RoleName>("Pharmacist");
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      title="Issue a staff account"
      icon={UserPlus}
      width={620}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="primary"
            icon={UserPlus}
            busy={busy}
            disabled={!name.trim() || !email.trim()}
            style={{ flex: 1 }}
            onClick={async () => {
              setBusy(true);
              await onSubmit({ name, email, phone, department, role });
              setBusy(false);
            }}
          >
            Generate ID and password
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <Grid cols={2}>
        <Field label="Full name" required>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={name}
              placeholder="Dr. Meera Iyer"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Department / ward" hint="Shown on their prescriptions">
          {(id) => (
            <Input
              id={id}
              value={department}
              placeholder="General Medicine"
              onChange={(e) => setDepartment(e.target.value)}
            />
          )}
        </Field>
      </Grid>

      <Grid cols={2}>
        <Field label="Email" hint="They can sign in with this too" required>
          {(id) => (
            <Input
              id={id}
              type="email"
              value={email}
              placeholder="meera@hospital.in"
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Phone">
          {(id) => (
            <Input
              id={id}
              type="tel"
              value={phone}
              placeholder="+91 98xxx xxxxx"
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </Field>
      </Grid>

      <div className="f">
        <label>Role — decides which console they get</label>
        <RolePicker value={role} onChange={setRole} />
        <span className="hint">
          {ROLES[role].blurb} Their Staff ID will start with{" "}
          <strong>{ROLES[role].idPrefix}-</strong>.
        </span>
      </div>

      <Banner tone="info">
        A Staff ID and a one-time password are generated when you submit. You'll
        see the password once — copy or print it before closing.
      </Banner>
    </Modal>
  );
}

/** Shown exactly once. The temporary password is not recoverable afterwards. */
function CredentialsDialog({
  issued,
  onClose,
}: {
  issued: IssuedCredentials;
  onClose: () => void;
}) {
  const toast = useToast();
  const slip = credentialSlip(issued.user, issued.temporaryPassword);
  const [confirmed, setConfirmed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(slip);
      toast.ok("Credentials copied to the clipboard.");
    } catch {
      toast.error("Couldn't reach the clipboard — copy the text manually.");
    }
  };

  return (
    <Modal
      title="Account issued"
      icon={ShieldCheck}
      width={560}
      tone="ok"
      onClose={confirmed ? onClose : () => undefined}
      footer={
        <>
          <Button icon={Copy} onClick={copy}>
            Copy
          </Button>
          <Button icon={Printer} onClick={() => window.print()}>
            Print slip
          </Button>
          <Button
            variant="primary"
            style={{ marginLeft: "auto" }}
            disabled={!confirmed}
            onClick={onClose}
          >
            Done
          </Button>
        </>
      }
    >
      <Banner tone="warn">
        This password is shown <strong>once</strong>. It isn't stored anywhere in
        readable form — if you lose it, issue a reset.
      </Banner>

      <div className="receipt print-me" style={{ fontSize: 13 }}>
        <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap" }}>{slip}</pre>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div className="eyebrow">Staff ID</div>
        <div className="mono cred">{issued.staffId}</div>
        <div className="eyebrow">Temporary password</div>
        <div className="mono cred">{issued.temporaryPassword}</div>
      </div>

      <label className="remember">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I've copied or printed these credentials
      </label>
    </Modal>
  );
}

function ChangeRoleDialog({
  user,
  onClose,
  onSubmit,
}: {
  user: User;
  onClose: () => void;
  onSubmit: (role: RoleName) => Promise<void>;
}) {
  const [role, setRole] = useState<RoleName>(user.role);
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      title={`Change role — ${user.name}`}
      icon={ShieldCheck}
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="primary"
            busy={busy}
            disabled={role === user.role}
            style={{ flex: 1 }}
            onClick={async () => {
              setBusy(true);
              await onSubmit(role);
              setBusy(false);
            }}
          >
            Apply new role
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="sub">
        Currently {user.role} · {user.staffId}
      </div>
      <RolePicker value={role} onChange={setRole} />
      {role !== user.role && (
        <Banner tone="warn">
          Their Staff ID will be reissued as <strong>{ROLES[role].idPrefix}-…</strong>{" "}
          because the prefix encodes the role. Tell them the new ID — the old one
          stops working.
        </Banner>
      )}
    </Modal>
  );
}
