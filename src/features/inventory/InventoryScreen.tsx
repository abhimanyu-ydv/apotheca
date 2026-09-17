import { useMemo, useState } from "react";
import { Boxes, Download, Minus, Plus, Trash2 } from "lucide-react";

import {
  ADJUST_REASONS,
  type AdjustReason,
  type Batch,
  type DosageForm,
} from "./constants";
import {
  FORMS,
  canDo,
  expiryStatus,
  filterBatches,
  formatMoney,
  inventoryCsv,
  isLowStock,
  packUnit,
  stockValue,
} from "@/domain";
import { DrugCell, ExpiryCell, LifeBar } from "@/components/ExpiryBits";
import { useActions, useCurrentUser, useDerived } from "@/state/store";
import { DataTable, type Column } from "@/ui/DataTable";
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  Grid,
  Input,
  Modal,
  Screen,
  SearchInput,
  Select,
  Stat,
  Tag,
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";

export function InventoryScreen() {
  const { stockIndex } = useDerived();
  const user = useCurrentUser();
  const actions = useActions();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [form, setForm] = useState<DosageForm | "All">("All");
  const [deleting, setDeleting] = useState<Batch | null>(null);
  const [adjusting, setAdjusting] = useState<Batch | null>(null);

  const mayDelete = canDo(user, "deleteStock");
  const mayAdjust = canDo(user, "adjustStock");
  // Purchase cost and margin are commercially sensitive — clinical roles get
  // availability and MRP, not what the pharmacy paid.
  const maySeeCost = canDo(user, "viewCost");

  const rows = useMemo(
    () => filterBatches(stockIndex, query, form),
    [stockIndex, query, form],
  );

  const totals = useMemo(
    () => ({
      value: stockValue(rows),
      units: rows.reduce((n, b) => n + b.qty, 0),
      low: rows.filter(isLowStock).length,
    }),
    [rows],
  );

  const columns: Column<Batch>[] = [
    {
      key: "name",
      header: "Medicine",
      sortBy: (b) => b.name,
      render: (b) => <DrugCell name={b.name} secondary={b.brand || "—"} />,
    },
    {
      key: "strength",
      header: "Strength",
      sortBy: (b) => b.strength,
      render: (b) => (
        <>
          <span className="mono">{b.strength}</span>
          <div className="sub">{b.form}</div>
        </>
      ),
    },
    {
      key: "batchNo",
      header: "Batch",
      sortBy: (b) => b.batchNo,
      render: (b) => (
        <span className="mono" style={{ fontSize: 11 }}>
          {b.batchNo}
        </span>
      ),
    },
    {
      key: "expiry",
      header: "Expiry",
      sortBy: (b) => b.expiry,
      render: (b) => <ExpiryCell date={b.expiry} />,
    },
    {
      key: "life",
      header: "Shelf life",
      width: 90,
      render: (b) => <LifeBar batch={b} />,
    },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      sortBy: (b) => b.qty,
      render: (b) => (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
            {mayAdjust && (
              <Button
                size="sm"
                icon={Minus}
                aria-label="Decrease by one"
                disabled={b.qty <= 0}
                onClick={() => void actions.adjustQty(b.id, -1, "Correction")}
              />
            )}
            <span
              className="mono"
              style={{
                minWidth: 34,
                textAlign: "center",
                fontWeight: 600,
                color: isLowStock(b) ? "var(--amber)" : undefined,
              }}
            >
              {b.qty}
            </span>
            {mayAdjust && (
              <Button
                size="sm"
                icon={Plus}
                aria-label="Increase by one"
                onClick={() => void actions.adjustQty(b.id, 1, "Correction")}
              />
            )}
          </div>
          {isLowStock(b) && (
            <div style={{ marginTop: 4 }}>
              <Tag tone="warn">Reorder</Tag>
            </div>
          )}
        </>
      ),
    },
    {
      key: "mrp",
      header: "MRP",
      align: "right",
      sortBy: (b) => b.mrp,
      render: (b) => formatMoney(b.mrp),
    },
    ...(maySeeCost
      ? [
          {
            key: "value",
            header: "Value",
            align: "right" as const,
            sortBy: (b: Batch) => b.qty * (b.cost || b.mrp),
            render: (b: Batch) => formatMoney(b.qty * (b.cost || b.mrp)),
          },
        ]
      : []),
    {
      key: "rack",
      header: "Rack",
      sortBy: (b) => b.rack,
      render: (b) => <span className="mono">{b.rack || "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (b) => (
        <div style={{ display: "flex", gap: 6 }}>
          {mayAdjust && (
            <Button size="sm" onClick={() => setAdjusting(b)}>
              Adjust
            </Button>
          )}
          {mayDelete && (
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              aria-label="Delete batch"
              onClick={() => setDeleting(b)}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <Screen
      eyebrow="Shelf"
      title="Stock on hand"
      actions={
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Medicine, brand, batch, rack…"
            minWidth={260}
          />
          <Select
            value={form}
            onValueChange={(v) => setForm(v as DosageForm | "All")}
            options={[
              { value: "All", label: "All forms" },
              ...FORMS.map((f) => ({ value: f, label: f })),
            ]}
            style={{ width: "auto" }}
            className="control"
          />
          <Button
            icon={Download}
            disabled={!maySeeCost}
            title={maySeeCost ? "Export the filtered rows" : "Export needs pharmacy access"}
            onClick={() => {
              void actions.exportCsv(
                `apotheca-stock-${new Date().toISOString().slice(0, 10)}.csv`,
                inventoryCsv(rows),
              );
              toast.ok(`Exported ${rows.length} rows to CSV.`);
            }}
          >
            CSV
          </Button>
        </>
      }
    >
      <Grid cols={3}>
        <Stat label="Batches shown" value={rows.length} sub={`${totals.units} units`} />
        {maySeeCost ? (
          <Stat label="Stock value (cost)" value={formatMoney(totals.value)} />
        ) : (
          <Stat
            label="Dispensable now"
            value={rows.filter((b) => b.qty > 0 && expiryStatus(b.expiry).level !== "expired").length}
            sub="batches not expired"
          />
        )}
        <Stat
          label="At or below reorder"
          value={totals.low}
          tone={totals.low ? "warn" : "neutral"}
        />
      </Grid>

      <Card padded={false}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(b) => b.id}
          rowClass={(b) => (expiryStatus(b.expiry).level === "expired" ? "danger" : undefined)}
          initialSort={{ key: "expiry", dir: "asc" }}
          emptyIcon={Boxes}
          emptyMessage="No batches match those filters."
        />
      </Card>

      {adjusting && (
        <AdjustDialog
          batch={adjusting}
          onClose={() => setAdjusting(null)}
          onSubmit={async (delta, reason, note) => {
            await actions.adjustQty(adjusting.id, delta, reason, note);
            toast.ok(`${adjusting.name} adjusted by ${delta > 0 ? "+" : ""}${delta}.`);
            setAdjusting(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete batch from shelf"
          confirmWord="DELETE"
          confirmLabel="Remove batch"
          requireReason
          body={
            <div>
              <strong>
                {deleting.name} {deleting.strength}
              </strong>
              <div className="sub">
                Batch {deleting.batchNo} · {deleting.qty} {packUnit(deleting.form)} ·
                expires {deleting.expiry}
              </div>
              <div style={{ marginTop: 8 }}>
                This removes {formatMoney(deleting.qty * (deleting.cost || deleting.mrp))} of
                stock and is recorded in the audit log.
              </div>
            </div>
          }
          onCancel={() => setDeleting(null)}
          onConfirm={async (reason) => {
            await actions.deleteBatch(deleting.id, reason);
            toast.warn(`Deleted batch ${deleting.batchNo}.`);
            setDeleting(null);
          }}
        />
      )}
    </Screen>
  );
}

/** Quantity change with a mandatory reason code — new, and audit-visible. */
function AdjustDialog({
  batch,
  onClose,
  onSubmit,
}: {
  batch: Batch;
  onClose: () => void;
  onSubmit: (delta: number, reason: AdjustReason, note: string) => Promise<void>;
}) {
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState<AdjustReason>("Correction");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const magnitude = Math.max(0, Math.trunc(Number(amount) || 0));
  const delta = direction === "add" ? magnitude : -magnitude;
  const resulting = Math.max(0, batch.qty + delta);

  return (
    <Modal
      title={`Adjust ${batch.name} ${batch.strength}`}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="primary"
            style={{ flex: 1 }}
            busy={busy}
            disabled={magnitude === 0}
            onClick={async () => {
              setBusy(true);
              await onSubmit(delta, reason, note);
              setBusy(false);
            }}
          >
            Apply
          </Button>
          <Button variant="ghost" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="sub">
        Batch {batch.batchNo} · currently {batch.qty} {packUnit(batch.form)}
      </div>

      <Grid cols={2}>
        <Field label="Direction">
          {(id) => (
            <Select
              id={id}
              value={direction}
              onValueChange={(v) => setDirection(v as "add" | "remove")}
              options={[
                { value: "remove", label: "Remove from shelf" },
                { value: "add", label: "Add to shelf" },
              ]}
            />
          )}
        </Field>
        <Field label="Quantity">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
      </Grid>

      <Field label="Reason" hint="Recorded in the audit log">
        {(id) => (
          <Select
            id={id}
            value={reason}
            onValueChange={(v) => setReason(v as AdjustReason)}
            options={ADJUST_REASONS.map((r) => ({ value: r, label: r }))}
          />
        )}
      </Field>

      <Field label="Note" hint="Optional detail">
        {(id) => (
          <Input
            id={id}
            value={note}
            placeholder="e.g. broken vial during transfer"
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>

      <div className="banner b-info">
        New quantity will be <strong>&nbsp;{resulting}&nbsp;</strong> {packUnit(batch.form)}.
      </div>
    </Modal>
  );
}
