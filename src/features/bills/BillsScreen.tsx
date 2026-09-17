import { useMemo, useState } from "react";
import { Download, Receipt, RotateCcw } from "lucide-react";

import {
  billsCsv,
  canDo,
  formatDateTime,
  formatMoney,
  summarise,
  type Bill,
} from "@/domain";
import { useActions, useAppState, useCurrentUser } from "@/state/store";
import { DataTable, type Column } from "@/ui/DataTable";
import {
  Button,
  Card,
  ConfirmDialog,
  Grid,
  Screen,
  SearchInput,
  Select,
  Stat,
  Tag,
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { BillReceipt } from "../billing/BillReceipt";

type Period = "all" | "today" | "week" | "month";

const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = {
  today: 1,
  week: 7,
  month: 30,
};

export function BillsScreen() {
  const { bills } = useAppState();
  const user = useCurrentUser();
  const actions = useActions();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [open, setOpen] = useState<Bill | null>(null);
  const [returning, setReturning] = useState<Bill | null>(null);

  const mayReturn = canDo(user, "returnBill");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoff =
      period === "all"
        ? 0
        : Date.now() - PERIOD_DAYS[period] * 86_400_000;

    return bills
      .filter((b) => {
        if (cutoff && new Date(b.at).getTime() < cutoff) return false;
        if (!q) return true;
        return `${b.no} ${b.patientName} ${b.patientId} ${b.doctor} ${b.byName}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [bills, query, period]);

  const summary = useMemo(() => summarise(rows), [rows]);
  const returnedCount = rows.filter((b) => b.status === "returned").length;

  const columns: Column<Bill>[] = [
    {
      key: "no",
      header: "Bill",
      sortBy: (b) => b.no,
      render: (b) => (
        <>
          <div className="mono" style={{ fontWeight: 600, fontSize: 11 }}>
            {b.no}
          </div>
          {b.status === "returned" && <Tag tone="bad">Returned</Tag>}
        </>
      ),
    },
    {
      key: "at",
      header: "Date & time",
      sortBy: (b) => b.at,
      render: (b) => <span className="mono" style={{ fontSize: 11 }}>{formatDateTime(b.at)}</span>,
    },
    {
      key: "patient",
      header: "Patient",
      sortBy: (b) => b.patientName,
      render: (b) => (
        <>
          <div style={{ fontWeight: 600 }}>{b.patientName}</div>
          {b.patientId && <div className="sub mono">{b.patientId}</div>}
        </>
      ),
    },
    {
      key: "doctor",
      header: "Doctor",
      sortBy: (b) => b.doctor,
      render: (b) => b.doctor || "—",
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      sortBy: (b) => b.lines.length,
      render: (b) => b.lines.length,
    },
    {
      key: "pay",
      header: "Paid by",
      sortBy: (b) => b.pay,
      render: (b) => <span className="sub">{b.pay}</span>,
    },
    {
      key: "net",
      header: "Amount",
      align: "right",
      sortBy: (b) => b.net,
      render: (b) => (
        <span
          style={{
            fontWeight: 600,
            textDecoration: b.status === "returned" ? "line-through" : undefined,
            color: b.status === "returned" ? "var(--muted)" : undefined,
          }}
        >
          {formatMoney(b.net)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (b) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" onClick={() => setOpen(b)}>
            View
          </Button>
          {mayReturn && b.status === "issued" && (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              aria-label="Return bill"
              title="Return this bill and put the stock back"
              onClick={() => setReturning(b)}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <Screen
      eyebrow="Records"
      title="Billing history"
      actions={
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Bill no, patient, ID, doctor…"
            minWidth={260}
          />
          <Select
            value={period}
            onValueChange={(v) => setPeriod(v as Period)}
            className="control"
            style={{ width: "auto" }}
            options={[
              { value: "all", label: "All time" },
              { value: "today", label: "Last 24 hours" },
              { value: "week", label: "Last 7 days" },
              { value: "month", label: "Last 30 days" },
            ]}
          />
          <Button
            icon={Download}
            disabled={rows.length === 0}
            onClick={() => {
              void actions.exportCsv(
                `apotheca-bills-${new Date().toISOString().slice(0, 10)}.csv`,
                billsCsv(rows),
              );
              toast.ok(`Exported ${rows.length} bills to CSV.`);
            }}
          >
            CSV
          </Button>
        </>
      }
    >
      <Grid cols={4}>
        <Stat label="Bills" value={summary.count} sub={returnedCount ? `${returnedCount} returned` : undefined} />
        <Stat label="Revenue" value={formatMoney(summary.gross)} />
        <Stat label="GST collected" value={formatMoney(summary.gst)} />
        <Stat label="Average bill" value={formatMoney(summary.average)} />
      </Grid>

      <Card padded={false}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(b) => b.id}
          rowClass={(b) => (b.status === "returned" ? "danger" : undefined)}
          emptyIcon={Receipt}
          emptyMessage="No bills match those filters."
        />
      </Card>

      {open && <BillReceipt bill={open} onClose={() => setOpen(null)} />}

      {returning && (
        <ConfirmDialog
          title={`Return bill ${returning.no}`}
          confirmLabel="Return and restock"
          requireReason
          body={
            <div>
              <p style={{ marginTop: 0 }}>
                This voids the bill and puts{" "}
                <strong>
                  {returning.lines.reduce((n, l) => n + l.qty, 0)} units
                </strong>{" "}
                back onto the shelf, into the same batches they came from.
              </p>
              <div className="sub">
                {returning.patientName} · {formatMoney(returning.net)} ·{" "}
                {formatDateTime(returning.at)}
              </div>
            </div>
          }
          onCancel={() => setReturning(null)}
          onConfirm={async (reason) => {
            const problem = await actions.returnBill(returning.id, reason);
            if (problem) toast.error(problem);
            else toast.warn(`Bill ${returning.no} returned and stock restored.`);
            setReturning(null);
          }}
        />
      )}
    </Screen>
  );
}
