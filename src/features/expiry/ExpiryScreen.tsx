import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Trash2 } from "lucide-react";

import {
  EXPIRY_THRESHOLDS,
  bucketByExpiry,
  canDo,
  formatMoney,
  packUnit,
  writeOffValue,
  type Batch,
} from "@/domain";
import { DrugCell, ExpiryCell } from "@/components/ExpiryBits";
import { useActions, useCurrentUser, useDerived } from "@/state/store";
import { DataTable, type Column } from "@/ui/DataTable";
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Grid,
  Screen,
  Stat,
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";

export function ExpiryScreen() {
  const { stockIndex } = useDerived();
  const user = useCurrentUser();
  const actions = useActions();
  const toast = useToast();

  const [confirmWriteOff, setConfirmWriteOff] = useState(false);
  const mayWriteOff = canDo(user, "writeOffExpired");
  const maySeeCost = canDo(user, "viewCost");

  const buckets = useMemo(() => bucketByExpiry(stockIndex.all), [stockIndex]);
  const loss = writeOffValue(buckets.expired);

  const columns = (showValue = maySeeCost): Column<Batch>[] => [
    {
      key: "name",
      header: "Medicine",
      sortBy: (b) => b.name,
      render: (b) => (
        <DrugCell
          name={b.name}
          strength={b.strength}
          secondary={`${b.brand || "—"} · ${b.form}${b.rack ? ` · rack ${b.rack}` : ""}`}
        />
      ),
    },
    {
      key: "batchNo",
      header: "Batch",
      sortBy: (b) => b.batchNo,
      render: (b) => <span className="mono">{b.batchNo}</span>,
    },
    {
      key: "expiry",
      header: "Expiry",
      sortBy: (b) => b.expiry,
      render: (b) => <ExpiryCell date={b.expiry} />,
    },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      sortBy: (b) => b.qty,
      render: (b) => `${b.qty} ${packUnit(b.form)}`,
    },
    ...(showValue
      ? [
          {
            key: "value",
            header: "Value at cost",
            align: "right" as const,
            sortBy: (b: Batch) => b.qty * (b.cost || b.mrp),
            render: (b: Batch) => formatMoney(b.qty * (b.cost || b.mrp)),
          },
        ]
      : []),
  ];

  return (
    <Screen
      eyebrow="Quality control"
      title="Expiry desk"
      actions={
        mayWriteOff && buckets.expired.length > 0 ? (
          <Button variant="danger" icon={Trash2} onClick={() => setConfirmWriteOff(true)}>
            Write off {buckets.expired.length} expired
          </Button>
        ) : undefined
      }
    >
      {buckets.expired.length > 0 && (
        <Banner tone="bad" icon={AlertTriangle}>
          <strong>
            {buckets.expired.length} expired batch
            {buckets.expired.length === 1 ? "" : "es"} still on the shelf.
          </strong>{" "}
          They are blocked from dispensing, but carrying them is a licensing risk.
          Write-off value {formatMoney(loss)}.
        </Banner>
      )}

      <Grid cols={4}>
        <Stat
          label="Expired"
          value={buckets.expired.length}
          sub={formatMoney(loss)}
          tone={buckets.expired.length ? "bad" : "neutral"}
        />
        <Stat
          label={`Within ${EXPIRY_THRESHOLDS.critical} days`}
          value={buckets.critical.length}
          sub={formatMoney(writeOffValue(buckets.critical))}
          tone={buckets.critical.length ? "warn" : "neutral"}
        />
        <Stat
          label={`Within ${EXPIRY_THRESHOLDS.warning} days`}
          value={buckets.warning.length}
          sub={formatMoney(writeOffValue(buckets.warning))}
        />
        <Stat label="Healthy" value={buckets.ok.length} tone="ok" />
      </Grid>

      <Card
        title="Expired — remove from shelf"
        icon={AlertTriangle}
        count={buckets.expired.length}
        padded={false}
        aside={<span className="sub">Blocked from dispensing</span>}
      >
        <DataTable
          rows={buckets.expired}
          columns={columns()}
          rowKey={(b) => b.id}
          rowClass={() => "danger"}
          emptyIcon={CalendarClock}
          emptyMessage="Nothing expired. Good."
        />
      </Card>

      <Card
        title={`Expiring within ${EXPIRY_THRESHOLDS.critical} days`}
        count={buckets.critical.length}
        padded={false}
        aside={<span className="sub">Dispense these first — FEFO does it automatically</span>}
      >
        <DataTable
          rows={buckets.critical}
          columns={columns()}
          rowKey={(b) => b.id}
          emptyIcon={CalendarClock}
          emptyMessage="Nothing expiring this month."
        />
      </Card>

      <Card
        title={`Expiring within ${EXPIRY_THRESHOLDS.warning} days`}
        count={buckets.warning.length}
        padded={false}
        aside={<span className="sub">Plan returns to the supplier</span>}
      >
        <DataTable
          rows={buckets.warning}
          columns={columns()}
          rowKey={(b) => b.id}
          emptyIcon={CalendarClock}
          emptyMessage="Nothing in the 90-day window."
        />
      </Card>

      {confirmWriteOff && (
        <ConfirmDialog
          title="Write off expired stock"
          confirmWord="WRITE OFF"
          confirmLabel={`Remove ${buckets.expired.length} batches`}
          body={
            <div>
              <p style={{ marginTop: 0 }}>
                This removes all {buckets.expired.length} expired batches from the
                shelf and records a loss of{" "}
                <strong>{formatMoney(loss)}</strong> in the audit log.
              </p>
              <div className="sub">
                {buckets.expired
                  .slice(0, 6)
                  .map((b) => `${b.name} ${b.strength} (${b.batchNo})`)
                  .join(", ")}
                {buckets.expired.length > 6 && ` and ${buckets.expired.length - 6} more`}
              </div>
            </div>
          }
          onCancel={() => setConfirmWriteOff(false)}
          onConfirm={async () => {
            await actions.writeOffExpired(buckets.expired.map((b) => b.id));
            toast.warn(`Wrote off ${buckets.expired.length} batches — ${formatMoney(loss)}.`);
            setConfirmWriteOff(false);
          }}
        />
      )}
    </Screen>
  );
}
