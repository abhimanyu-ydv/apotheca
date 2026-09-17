import { useMemo, useState } from "react";
import { Plus, User as UserIcon } from "lucide-react";

import { formatDate, formatMoney, type Bill, type Patient } from "@/domain";
import { useActions, useAppState } from "@/state/store";
import { DataTable, type Column } from "@/ui/DataTable";
import {
  Button,
  Card,
  Field,
  Grid,
  Input,
  Modal,
  Screen,
  SearchInput,
  Select,
  Stat,
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";

/**
 * Patient registry.
 *
 * `genPatientId` existed in the old build but was never called — patient IDs
 * were free text on the bill, so two "Ramesh Kumar"s were indistinguishable.
 * This registers them properly and links their dispensing history.
 */
export function PatientsScreen() {
  const { patients, bills } = useAppState();
  const actions = useActions();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<Patient | null>(null);

  /** patientId -> their bills, built once per bills change. */
  const historyById = useMemo(() => {
    const map = new Map<string, Bill[]>();
    for (const bill of bills) {
      if (!bill.patientId) continue;
      const list = map.get(bill.patientId);
      if (list) list.push(bill);
      else map.set(bill.patientId, [bill]);
    }
    return map;
  }, [bills]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) =>
      `${p.id} ${p.name} ${p.phone}`.toLowerCase().includes(q),
    );
  }, [patients, query]);

  const columns: Column<Patient>[] = [
    {
      key: "id",
      header: "Patient ID",
      sortBy: (p) => p.id,
      render: (p) => (
        <span className="mono" style={{ fontWeight: 600 }}>
          {p.id}
        </span>
      ),
    },
    { key: "name", header: "Name", sortBy: (p) => p.name, render: (p) => p.name },
    {
      key: "detail",
      header: "Age / sex",
      render: (p) => [p.age, p.sex].filter(Boolean).join(" / ") || "—",
    },
    {
      key: "phone",
      header: "Phone",
      render: (p) => <span className="mono">{p.phone || "—"}</span>,
    },
    {
      key: "visits",
      header: "Bills",
      align: "right",
      sortBy: (p) => historyById.get(p.id)?.length ?? 0,
      render: (p) => historyById.get(p.id)?.length ?? 0,
    },
    {
      key: "spend",
      header: "Total billed",
      align: "right",
      sortBy: (p) =>
        (historyById.get(p.id) ?? []).reduce(
          (n, b) => n + (b.status === "issued" ? b.net : 0),
          0,
        ),
      render: (p) =>
        formatMoney(
          (historyById.get(p.id) ?? []).reduce(
            (n, b) => n + (b.status === "issued" ? b.net : 0),
            0,
          ),
        ),
    },
    {
      key: "since",
      header: "Registered",
      sortBy: (p) => p.createdAt,
      render: (p) => <span className="mono" style={{ fontSize: 11 }}>{formatDate(p.createdAt)}</span>,
    },
  ];

  const totalBilled = useMemo(
    () => bills.reduce((n, b) => n + (b.status === "issued" ? b.net : 0), 0),
    [bills],
  );

  return (
    <Screen
      eyebrow="Registry"
      title="Patients"
      actions={
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Name, ID or phone…" />
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            Register patient
          </Button>
        </>
      }
    >
      <Grid cols={3}>
        <Stat label="Registered patients" value={patients.length} />
        <Stat label="Bills on file" value={bills.length} />
        <Stat label="Total billed" value={formatMoney(totalBilled)} />
      </Grid>

      <Card padded={false}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(p) => p.id}
          initialSort={{ key: "since", dir: "desc" }}
          onRowClick={setViewing}
          emptyIcon={UserIcon}
          emptyMessage="No patients registered yet. Registering one gives them a stable ID that survives name collisions."
        />
      </Card>

      {adding && (
        <RegisterDialog
          onClose={() => setAdding(false)}
          onSubmit={async (input) => {
            const patient = await actions.registerPatient(input);
            toast.ok(`${patient.name} registered as ${patient.id}.`);
            setAdding(false);
          }}
        />
      )}

      {viewing && (
        <Modal
          title={`${viewing.name} — ${viewing.id}`}
          icon={UserIcon}
          width={620}
          onClose={() => setViewing(null)}
        >
          <Grid cols={3}>
            <Stat label="Bills" value={historyById.get(viewing.id)?.length ?? 0} />
            <Stat
              label="Total billed"
              value={formatMoney(
                (historyById.get(viewing.id) ?? []).reduce(
                  (n, b) => n + (b.status === "issued" ? b.net : 0),
                  0,
                ),
              )}
            />
            <Stat label="Registered" value={formatDate(viewing.createdAt)} />
          </Grid>

          {viewing.notes && (
            <div className="banner b-info">
              <span>{viewing.notes}</span>
            </div>
          )}

          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Date</th>
                  <th className="num">Items</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(historyById.get(viewing.id) ?? [])
                  .sort((a, b) => (a.at < b.at ? 1 : -1))
                  .map((b) => (
                    <tr key={b.id}>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {b.no}
                      </td>
                      <td>{formatDate(b.at)}</td>
                      <td className="num">{b.lines.length}</td>
                      <td className="num">{formatMoney(b.net)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {(historyById.get(viewing.id) ?? []).length === 0 && (
              <div className="empty" style={{ padding: 24 }}>
                No bills recorded against this ID yet.
              </div>
            )}
          </div>
        </Modal>
      )}
    </Screen>
  );
}

function RegisterDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: Omit<Patient, "id" | "createdAt">) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<Patient["sex"]>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      title="Register a patient"
      icon={UserIcon}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="primary"
            style={{ flex: 1 }}
            busy={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              await onSubmit({ name: name.trim(), phone: phone.trim(), age, sex, notes: notes.trim() });
              setBusy(false);
            }}
          >
            Register
          </Button>
          <Button variant="ghost" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <Field label="Full name" required>
        {(id) => (
          <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <Grid cols={3}>
        <Field label="Phone">
          {(id) => (
            <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          )}
        </Field>
        <Field label="Age">
          {(id) => <Input id={id} value={age} onChange={(e) => setAge(e.target.value)} />}
        </Field>
        <Field label="Sex">
          {(id) => (
            <Select
              id={id}
              value={sex}
              onValueChange={(v) => setSex(v as Patient["sex"])}
              options={[
                { value: "", label: "—" },
                { value: "M", label: "Male" },
                { value: "F", label: "Female" },
                { value: "O", label: "Other" },
              ]}
            />
          )}
        </Field>
      </Grid>
      <Field label="Notes" hint="Allergies, chronic conditions, anything the counter should know">
        {(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      <div className="banner b-info">
        A unique ID (PAT-#####) is assigned automatically.
      </div>
    </Modal>
  );
}
