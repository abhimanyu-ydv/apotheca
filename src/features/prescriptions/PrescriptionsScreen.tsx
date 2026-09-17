import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  FileText,
  Plus,
  Send,
  Stethoscope,
  X,
} from "lucide-react";

import {
  FREQUENCIES,
  canDo,
  checkAvailability,
  filterPrescriptions,
  formatDateTime,
  friendlyName,
  packUnit,
  pendingQueue,
  type FillLevel,
  type FrequencyCode,
  type Prescription,
  type PrescriptionStatus,
} from "@/domain";
import { useActions, useAppState, useCurrentUser, useDerived } from "@/state/store";
import { DataTable, type Column } from "@/ui/DataTable";
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Grid,
  Modal,
  Screen,
  SearchInput,
  Select,
  Stat,
  Tag,
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { WritePrescription } from "./WritePrescription";

const STATUS_TONE: Record<PrescriptionStatus, "ok" | "warn" | "bad" | "neutral"> = {
  open: "warn",
  dispensed: "ok",
  cancelled: "bad",
};

const FILL_TONE: Record<FillLevel, "ok" | "warn" | "bad"> = {
  full: "ok",
  partial: "warn",
  none: "bad",
};

const FILL_LABEL: Record<FillLevel, string> = {
  full: "In stock",
  partial: "Part stock",
  none: "Out of stock",
};

/**
 * One screen, two jobs:
 *   - a Doctor writes prescriptions and watches them get filled
 *   - a Pharmacist / Pharmacy Staff works the queue and sends one to billing
 *
 * Which half you get is decided by `writePrescription` / `fulfilPrescription`.
 */
export function PrescriptionsScreen() {
  const { prescriptions } = useAppState();
  const { stockIndex } = useDerived();
  const user = useCurrentUser();
  const actions = useActions();
  const toast = useToast();

  const mayWrite = canDo(user, "writePrescription");
  const mayFulfil = canDo(user, "fulfilPrescription");

  const [writing, setWriting] = useState(false);
  const [viewing, setViewing] = useState<Prescription | null>(null);
  const [cancelling, setCancelling] = useState<Prescription | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PrescriptionStatus | "All">(
    mayFulfil ? "open" : "All",
  );

  /** Doctors see their own pad; the counter sees everyone's. */
  const scope = useMemo(
    () => (mayWrite && !mayFulfil ? prescriptions.filter((p) => p.doctorId === user.id) : prescriptions),
    [prescriptions, mayWrite, mayFulfil, user.id],
  );

  const rows = useMemo(
    () => filterPrescriptions(scope, query, status),
    [scope, query, status],
  );

  /** Availability per prescription, computed once per stock/queue change. */
  const availability = useMemo(() => {
    const map = new Map<string, ReturnType<typeof checkAvailability>>();
    for (const rx of rows) map.set(rx.id, checkAvailability(rx, stockIndex));
    return map;
  }, [rows, stockIndex]);

  const queue = useMemo(() => pendingQueue(scope), [scope]);

  const columns: Column<Prescription>[] = [
    {
      key: "id",
      header: "Rx number",
      sortBy: (rx) => rx.id,
      render: (rx) => (
        <>
          <div className="mono" style={{ fontWeight: 600, fontSize: 11 }}>
            {rx.id}
          </div>
          <Tag tone={STATUS_TONE[rx.status]}>{rx.status}</Tag>
        </>
      ),
    },
    {
      key: "at",
      header: "Written",
      sortBy: (rx) => rx.at,
      render: (rx) => (
        <span className="mono" style={{ fontSize: 11 }}>
          {formatDateTime(rx.at)}
        </span>
      ),
    },
    {
      key: "patient",
      header: "Patient",
      sortBy: (rx) => rx.patientName,
      render: (rx) => (
        <>
          <div style={{ fontWeight: 600 }}>{rx.patientName}</div>
          <div className="sub">
            {[rx.patientId, rx.patientAge && `${rx.patientAge}y`, rx.diagnosis]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </>
      ),
    },
    {
      key: "doctor",
      header: "Doctor",
      sortBy: (rx) => rx.doctorName,
      render: (rx) => rx.doctorName,
    },
    {
      key: "items",
      header: "Medicines",
      align: "right",
      sortBy: (rx) => rx.items.length,
      render: (rx) => rx.items.length,
    },
    {
      key: "stock",
      header: "Availability",
      render: (rx) => {
        if (rx.status !== "open") return <span className="sub">—</span>;
        const check = availability.get(rx.id);
        if (!check) return null;
        return (
          <>
            <Tag tone={FILL_TONE[check.level]}>{FILL_LABEL[check.level]}</Tag>
            {check.shortLines > 0 && (
              <div className="sub">
                {check.shortLines} of {rx.items.length} short
              </div>
            )}
          </>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (rx) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" onClick={() => setViewing(rx)}>
            Open
          </Button>
          {mayFulfil && rx.status === "open" && (
            <Button
              size="sm"
              variant="primary"
              icon={Send}
              disabled={availability.get(rx.id)?.level === "none"}
              title={
                availability.get(rx.id)?.level === "none"
                  ? "Nothing on this prescription is in stock"
                  : "Load into the billing counter"
              }
              onClick={() => actions.startFilling(rx.id)}
            >
              Dispense
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Screen
      eyebrow={mayWrite ? "Prescription pad" : "Counter queue"}
      title={mayWrite ? "My prescriptions" : "Prescriptions"}
      actions={
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Rx number, patient, medicine…"
            minWidth={250}
          />
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as PrescriptionStatus | "All")}
            className="control"
            style={{ width: "auto" }}
            options={[
              { value: "All", label: "All statuses" },
              { value: "open", label: "Awaiting dispensing" },
              { value: "dispensed", label: "Dispensed" },
              { value: "cancelled", label: "Cancelled" },
            ]}
          />
          {mayWrite && (
            <Button variant="primary" icon={Plus} onClick={() => setWriting(true)}>
              Write prescription
            </Button>
          )}
        </>
      }
    >
      {mayWrite && !mayFulfil && (
        <Banner tone="info" icon={Stethoscope}>
          You're signed in as a Doctor. Write a prescription here and the pharmacy
          counter picks it up immediately — you'll see it turn <em>dispensed</em>{" "}
          with the bill number once it's filled.
        </Banner>
      )}

      {mayFulfil && queue.length > 0 && (
        <Banner tone="warn" icon={ClipboardList}>
          <strong>
            {queue.length} prescription{queue.length === 1 ? "" : "s"} waiting.
          </strong>{" "}
          Hit <em>Dispense</em> to load one into the counter — batches are picked
          by earliest expiry automatically.
        </Banner>
      )}

      <Grid cols={4}>
        <Stat
          label={mayWrite && !mayFulfil ? "Written by me" : "Total prescriptions"}
          value={scope.length}
        />
        <Stat
          label="Awaiting dispensing"
          value={queue.length}
          tone={queue.length ? "warn" : "neutral"}
        />
        <Stat
          label="Dispensed"
          value={scope.filter((p) => p.status === "dispensed").length}
          tone="ok"
        />
        <Stat
          label="Fully in stock"
          value={queue.filter((rx) => checkAvailability(rx, stockIndex).level === "full").length}
          sub="of those waiting"
        />
      </Grid>

      <Card padded={false}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(rx) => rx.id}
          initialSort={{ key: "at", dir: "desc" }}
          emptyIcon={FileText}
          emptyMessage={
            mayWrite
              ? "No prescriptions yet. Write one to send it to the counter."
              : "Nothing in the queue."
          }
        />
      </Card>

      {writing && (
        <WritePrescription
          onClose={() => setWriting(false)}
          onSubmit={async (draft, items) => {
            const rx = await actions.writePrescription(draft, items);
            toast.ok(`${rx.id} sent to the pharmacy counter.`);
            setWriting(false);
          }}
        />
      )}

      {viewing && (
        <PrescriptionDetail
          prescription={viewing}
          onClose={() => setViewing(null)}
          onCancel={() => {
            setCancelling(viewing);
            setViewing(null);
          }}
          onDispense={() => {
            actions.startFilling(viewing.id);
            setViewing(null);
          }}
        />
      )}

      {cancelling && (
        <ConfirmDialog
          title={`Cancel ${cancelling.id}`}
          confirmLabel="Cancel prescription"
          requireReason
          body={
            <p style={{ marginTop: 0 }}>
              This marks the prescription cancelled so the counter stops seeing it
              in the queue. {cancelling.patientName} ·{" "}
              {cancelling.items.length} medicine
              {cancelling.items.length === 1 ? "" : "s"}.
            </p>
          }
          onCancel={() => setCancelling(null)}
          onConfirm={async (reason) => {
            const problem = await actions.cancelPrescription(cancelling.id, reason);
            if (problem) toast.error(problem);
            else toast.warn(`${cancelling.id} cancelled.`);
            setCancelling(null);
          }}
        />
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------- detail */

function PrescriptionDetail({
  prescription: rx,
  onClose,
  onCancel,
  onDispense,
}: {
  prescription: Prescription;
  onClose: () => void;
  onCancel: () => void;
  onDispense: () => void;
}) {
  const { stockIndex } = useDerived();
  const user = useCurrentUser();
  const check = useMemo(() => checkAvailability(rx, stockIndex), [rx, stockIndex]);

  const mayFulfil = canDo(user, "fulfilPrescription");
  const mayCancel =
    rx.status === "open" &&
    (canDo(user, "writePrescription") ? rx.doctorId === user.id : mayFulfil);

  return (
    <Modal
      title={`${rx.id} — ${rx.patientName}`}
      icon={FileText}
      width={680}
      onClose={onClose}
      footer={
        <>
          {mayFulfil && rx.status === "open" && (
            <Button
              variant="primary"
              icon={Send}
              disabled={check.level === "none"}
              onClick={onDispense}
            >
              Dispense at counter
            </Button>
          )}
          {mayCancel && (
            <Button variant="danger" icon={X} onClick={onCancel}>
              Cancel Rx
            </Button>
          )}
          <Button variant="ghost" style={{ marginLeft: "auto" }} onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <Grid cols={3}>
        <Stat label="Status" value={rx.status} tone={STATUS_TONE[rx.status]} />
        <Stat label="Medicines" value={rx.items.length} />
        <Stat
          label="Availability"
          value={FILL_LABEL[check.level]}
          tone={FILL_TONE[check.level]}
        />
      </Grid>

      <div className="sub">
        Written {formatDateTime(rx.at)} by {rx.doctorName}
        {rx.patientId && ` · patient ${rx.patientId}`}
        {rx.patientAge && ` · ${rx.patientAge} years`}
      </div>

      {rx.diagnosis && (
        <div>
          <div className="eyebrow">Diagnosis</div>
          <div style={{ fontWeight: 500 }}>{rx.diagnosis}</div>
        </div>
      )}

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Dosing</th>
              <th className="num">Dispense</th>
              <th className="num">On shelf</th>
            </tr>
          </thead>
          <tbody>
            {check.lines.map(({ item, available, shortfall, level }) => (
              <tr key={item.id} className={level === "none" ? "danger" : undefined}>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {item.name}{" "}
                    <span className="mono" style={{ color: "var(--teal-d)" }}>
                      {item.strength}
                    </span>
                  </div>
                  <div className="sub">{item.form}</div>
                  {item.instructions && (
                    <div className="sub" style={{ fontStyle: "italic" }}>
                      {item.instructions}
                    </div>
                  )}
                </td>
                <td>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {item.frequency}
                  </span>
                  <div className="sub">
                    {item.dosePerTake} per dose · {item.durationDays} day
                    {item.durationDays === 1 ? "" : "s"}
                  </div>
                </td>
                <td className="num" style={{ fontWeight: 600 }}>
                  {item.qty} {packUnit(item.form)}
                </td>
                <td className="num">
                  {available}
                  {shortfall > 0 && (
                    <div style={{ color: "var(--red)", fontSize: 11 }}>
                      {shortfall} short
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rx.notes && (
        <div>
          <div className="eyebrow">Notes to the pharmacist</div>
          <div>{rx.notes}</div>
        </div>
      )}

      {rx.status === "dispensed" && (
        <Banner tone="ok" icon={CheckCircle2}>
          Dispensed by {rx.dispensedBy} on {formatDateTime(rx.dispensedAt ?? "")}
          {rx.billNo && ` against bill ${rx.billNo}`}.
        </Banner>
      )}
      {rx.status === "cancelled" && (
        <Banner tone="bad">
          Cancelled {formatDateTime(rx.cancelledAt ?? "")}
          {rx.cancelReason && ` — ${rx.cancelReason}`}
        </Banner>
      )}
      {rx.status === "open" && check.level !== "full" && (
        <Banner tone="warn">
          {check.shortLines} line{check.shortLines === 1 ? "" : "s"} can't be filled
          completely from current stock. You can still dispense what's available and
          tell {friendlyName(rx.patientName)} what's outstanding.
        </Banner>
      )}
    </Modal>
  );
}

export { FREQUENCIES };
export type { FrequencyCode };
