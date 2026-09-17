import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus, Receipt, Search, X, Zap } from "lucide-react";

import {
  MODES_NEEDING_REF,
  PAYMENT_MODES,
  addProductFefo,
  addToCart,
  buildBill,
  cartTotals,
  expiryStatus,
  formatDate,
  formatMoney,
  isDispensable,
  packUnit,
  removeFromCart,
  resolveCart,
  setCartQty,
  validateBill,
  type Bill,
  type CartItem,
  type PaymentMode,
  type ProductHit,
} from "@/domain";
import { MedicineSearch } from "@/components/MedicineSearch";
import { ExpiryTag } from "@/components/ExpiryBits";
import { useActions, useAppState, useCurrentUser, useDerived } from "@/state/store";
import {
  Banner,
  Button,
  Card,
  Field,
  Grid,
  Input,
  Screen,
  Select,
  Stack,
  Tag,
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { BillReceipt } from "./BillReceipt";

export function BillingScreen() {
  const { bills, prescriptions, fillingPrescriptionId } = useAppState();
  const { stockIndex } = useDerived();
  const user = useCurrentUser();
  const actions = useActions();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ProductHit | null>(null);
  const [fefoQty, setFefoQty] = useState("");
  const [cart, setCart] = useState<readonly CartItem[]>([]);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<Bill | null>(null);
  const [busy, setBusy] = useState(false);

  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [doctor, setDoctor] = useState("");
  const [discount, setDiscount] = useState("0");
  const [pay, setPay] = useState<PaymentMode>("Cash");
  const [payRef, setPayRef] = useState("");

  const lines = useMemo(() => resolveCart(cart, stockIndex), [cart, stockIndex]);
  const totals = useMemo(() => cartTotals(lines, Number(discount) || 0), [lines, discount]);

  /* ------------------------------------------------- prescription hand-off */

  const filling = useMemo(
    () => prescriptions.find((rx) => rx.id === fillingPrescriptionId) ?? null,
    [prescriptions, fillingPrescriptionId],
  );

  // Only load a given prescription into the cart once, even across re-renders.
  const loadedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!filling || loadedRef.current === filling.id) return;
    loadedRef.current = filling.id;

    // Walk the prescription lines through FEFO, accumulating into one cart.
    let next: readonly CartItem[] = [];
    let short = 0;
    for (const item of filling.items) {
      const result = addProductFefo(next, stockIndex, item, item.qty);
      next = result.cart;
      if (result.shortfall > 0) short += 1;
    }

    setCart(next);
    setPatientName(filling.patientName);
    setPatientId(filling.patientId);
    setDoctor(filling.doctorName);
    setError(
      short > 0
        ? `${short} of ${filling.items.length} prescribed lines couldn't be filled completely — check the quantities below.`
        : "",
    );
    toast.info(`${filling.id} loaded — ${next.length} batch${next.length === 1 ? "" : "es"} selected.`);
  }, [filling, stockIndex, toast]);

  /* --------------------------------------------------------------- cart */

  const addBatch = (batchId: string) => {
    const batch = stockIndex.byId.get(batchId);
    if (!batch) return;
    const result = addToCart(cart, batch, 1);
    if (result.error) return setError(result.error.message);
    setError("");
    setCart(result.cart);
    setPicked(null);
    setQuery("");
  };

  /** Let FEFO choose the batches for a whole quantity. */
  const addByFefo = () => {
    if (!picked) return;
    const wanted = Math.max(1, Math.trunc(Number(fefoQty) || 0));
    if (wanted <= 0) return setError("Enter how many units to dispense.");

    const result = addProductFefo(cart, stockIndex, picked, wanted);
    setCart(result.cart);

    if (result.shortfall > 0) {
      setError(
        `Only ${wanted - result.shortfall} of ${wanted} available — ${result.shortfall} short.`,
      );
    } else {
      setError("");
      toast.ok(
        `Added ${wanted} ${packUnit(picked.form)} across ${result.batchesUsed} batch${
          result.batchesUsed === 1 ? "" : "es"
        }, earliest expiry first.`,
      );
    }
    setPicked(null);
    setQuery("");
    setFefoQty("");
  };

  const changeQty = (batchId: string, value: string) => {
    const result = setCartQty(cart, batchId, Number(value), stockIndex);
    setCart(result.cart);
    setError(result.error?.message ?? "");
  };

  const resetForm = () => {
    setCart([]);
    setPatientName("");
    setPatientId("");
    setDoctor("");
    setDiscount("0");
    setPay("Cash");
    setPayRef("");
    setError("");
    loadedRef.current = null;
  };

  const detachPrescription = () => {
    actions.clearFilling();
    resetForm();
    toast.info("Prescription detached. The counter is clear.");
  };

  const finish = async () => {
    const draft = {
      patientName,
      patientId,
      doctor,
      pay,
      payRef,
      discountPct: Number(discount) || 0,
    };
    const check = validateBill(lines, draft);
    if (!check.ok) return setError(check.message);

    setBusy(true);
    const bill = buildBill(lines, draft, user, bills);
    await actions.issueBill(bill);
    setBusy(false);

    setIssued(bill);
    resetForm();
    toast.ok(`Bill ${bill.no} issued — ${formatMoney(bill.net)}`);
  };

  /* ------------------------------------------------------------- render */

  return (
    <Screen eyebrow="Counter" title="Dispense & bill">
      {filling && (
        <Banner tone="info" icon={FileText}>
          <strong>Filling {filling.id}</strong> — {filling.items.length} medicine
          {filling.items.length === 1 ? "" : "s"} prescribed by {filling.doctorName}
          {filling.diagnosis && ` for ${filling.diagnosis}`}. The prescription is
          marked dispensed once you issue the bill.{" "}
          <button className="link" style={{ color: "inherit", textDecoration: "underline" }} onClick={detachPrescription}>
            Detach
          </button>
        </Banner>
      )}

      {error && <Banner tone="bad">{error}</Banner>}

      <Grid cols="split">
        <Stack>
          <Card title="Add medicine" icon={Search}>
            <MedicineSearch
              value={query}
              onChange={setQuery}
              onPick={(hit) => {
                setPicked(hit);
                setFefoQty("");
              }}
              inStockOnly
              placeholder="Type a medicine or brand…"
            />

            {picked && (
              <div className="card" style={{ background: "var(--surface-2)" }}>
                <div className="card-h" style={{ padding: "9px 12px" }}>
                  <strong>
                    {picked.name} {picked.strength} · {picked.form}
                  </strong>
                  <Tag tone={picked.qty > 0 ? "ok" : "bad"}>
                    {picked.qty} {packUnit(picked.form)}
                  </Tag>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={X}
                    aria-label="Clear selection"
                    style={{ marginLeft: "auto" }}
                    onClick={() => setPicked(null)}
                  />
                </div>

                {/* FEFO: the recommended path — the operator gives a quantity
                    and the system picks batches by earliest expiry. */}
                <div
                  className="card-b"
                  style={{ gap: 8, borderBottom: "1px solid var(--line-2)" }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}>
                      <Field
                        label={`Quantity (${packUnit(picked.form)})`}
                        hint="Batches chosen automatically, earliest expiry first"
                      >
                        {(id) => (
                          <Input
                            id={id}
                            type="number"
                            min={1}
                            value={fefoQty}
                            placeholder="10"
                            onChange={(e) => setFefoQty(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && addByFefo()}
                          />
                        )}
                      </Field>
                    </div>
                    <Button
                      variant="primary"
                      icon={Zap}
                      disabled={picked.qty <= 0 || !fefoQty}
                      onClick={addByFefo}
                    >
                      Auto (FEFO)
                    </Button>
                  </div>
                </div>

                {/* Manual batch pick, for when the operator has a reason. */}
                {picked.batches.length === 0 ? (
                  <div style={{ padding: 14, color: "var(--muted)" }}>
                    No batches on the shelf.
                  </div>
                ) : (
                  <div className="scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Batch</th>
                          <th>Expiry</th>
                          <th className="num">Qty</th>
                          <th className="num">MRP</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {picked.batches.map((b) => {
                          const status = expiryStatus(b.expiry);
                          return (
                            <tr key={b.id} className={status.level === "expired" ? "danger" : undefined}>
                              <td className="mono">{b.batchNo}</td>
                              <td>
                                <span className="mono">{formatDate(b.expiry)}</span>{" "}
                                <ExpiryTag date={b.expiry} />
                              </td>
                              <td className="num">{b.qty}</td>
                              <td className="num">{formatMoney(b.mrp)}</td>
                              <td>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  icon={Plus}
                                  disabled={!isDispensable(b)}
                                  onClick={() => addBatch(b.id)}
                                >
                                  Add
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card
            title="Bill lines"
            icon={Receipt}
            aside={<span className="eyebrow">{lines.length} items</span>}
            padded={false}
          >
            {lines.length === 0 ? (
              <div className="empty">
                <Receipt size={26} />
                <p style={{ margin: 0 }}>Nothing added yet.</p>
              </div>
            ) : (
              <div className="scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Batch</th>
                      <th style={{ width: 90 }}>Qty</th>
                      <th className="num">Rate</th>
                      <th className="num">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.batch.id} className={line.problem ? "danger" : undefined}>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {line.batch.name}{" "}
                            <span className="mono" style={{ color: "var(--teal-d)" }}>
                              {line.batch.strength}
                            </span>
                          </div>
                          <div className="sub">
                            {line.batch.brand} · {line.batch.form}
                          </div>
                          {line.problem && (
                            <div style={{ color: "var(--red)", fontSize: 11.5 }}>
                              {line.problem}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="mono" style={{ fontSize: 11 }}>
                            {line.batch.batchNo}
                          </div>
                          <ExpiryTag date={line.batch.expiry} />
                        </td>
                        <td>
                          <input
                            className="control mono"
                            type="number"
                            min={1}
                            max={line.batch.qty}
                            value={line.qty}
                            aria-label={`Quantity for ${line.batch.name}`}
                            style={{ width: 72, padding: "6px 8px" }}
                            onChange={(e) => changeQty(line.batch.id, e.target.value)}
                          />
                        </td>
                        <td className="num">{formatMoney(line.batch.mrp)}</td>
                        <td className="num" style={{ fontWeight: 600 }}>
                          {formatMoney(line.lineTotal)}
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={X}
                            aria-label="Remove line"
                            onClick={() => setCart(removeFromCart(cart, line.batch.id))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Stack>

        <Stack>
          <Card title="Patient">
            <Field label="Patient name" required>
              {(id) => (
                <Input
                  id={id}
                  value={patientName}
                  placeholder="Ramesh Kumar"
                  onChange={(e) => setPatientName(e.target.value)}
                />
              )}
            </Field>
            <Field label="Patient ID" hint="Optional — prevents name collisions">
              {(id) => (
                <Input
                  id={id}
                  value={patientId}
                  placeholder="PAT-12345"
                  onChange={(e) => setPatientId(e.target.value)}
                />
              )}
            </Field>
            <Field label="Prescribing doctor">
              {(id) => (
                <Input
                  id={id}
                  value={doctor}
                  placeholder="Dr. Sharma"
                  onChange={(e) => setDoctor(e.target.value)}
                />
              )}
            </Field>
            <Field label="Payment mode">
              {(id) => (
                <Select
                  id={id}
                  value={pay}
                  onValueChange={(v) => setPay(v as PaymentMode)}
                  options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))}
                />
              )}
            </Field>
            {MODES_NEEDING_REF.has(pay) && (
              <Field label="Reference">
                {(id) => (
                  <Input
                    id={id}
                    value={payRef}
                    placeholder={
                      pay === "UPI" || pay === "GPay"
                        ? "name@upi"
                        : pay.includes("Card")
                          ? "Last 4 digits"
                          : "Transaction ID"
                    }
                    onChange={(e) => setPayRef(e.target.value)}
                  />
                )}
              </Field>
            )}
          </Card>

          <Card title="Total">
            <SummaryRow label="Taxable value" value={formatMoney(totals.taxable)} />
            {totals.gstBySlab.map((slab) => (
              <SummaryRow
                key={slab.rate}
                label={`GST @ ${slab.rate}%`}
                value={formatMoney(slab.gst)}
                muted
              />
            ))}
            <SummaryRow label="GST total" value={formatMoney(totals.gstTotal)} />

            <Field label="Discount %">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              )}
            </Field>

            {totals.discountAmt > 0 && (
              <SummaryRow
                label="Discount"
                value={`− ${formatMoney(totals.discountAmt)}`}
                colour="var(--amber)"
              />
            )}

            <div
              className="perf"
              style={{
                paddingTop: 10,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <strong>Payable</strong>
              <span className="disp mono" style={{ fontSize: 26, fontWeight: 600 }}>
                {formatMoney(totals.net)}
              </span>
            </div>

            <Button
              variant="primary"
              full
              icon={Receipt}
              busy={busy}
              disabled={lines.length === 0}
              onClick={finish}
            >
              Issue bill
            </Button>
          </Card>
        </Stack>
      </Grid>

      {issued && <BillReceipt bill={issued} onClose={() => setIssued(null)} />}
    </Screen>
  );
}

function SummaryRow({
  label,
  value,
  muted,
  colour,
}: {
  label: string;
  value: string;
  muted?: boolean;
  colour?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        color: colour ?? (muted ? "var(--muted)" : undefined),
        fontSize: muted ? 12.5 : undefined,
      }}
    >
      <span style={{ color: colour ? undefined : "var(--muted)" }}>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}
