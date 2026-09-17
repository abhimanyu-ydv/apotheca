import { useMemo, useState } from "react";
import { CheckCircle2, Package, Pill, Plus, Search, X } from "lucide-react";

import {
  CATALOG,
  FORMS,
  GST_RATES,
  canDo,
  daysUntil,
  findDuplicateBatch,
  formatMoney,
  packUnit,
  randomId,
  strengthsFor,
  toDateInput,
  type Batch,
  type DosageForm,
  type GstRate,
  type ProductHit,
  type Schedule,
} from "@/domain";
import { MedicineSearch } from "@/components/MedicineSearch";
import { ExpiryTag } from "@/components/ExpiryBits";
import { useActions, useCurrentUser, useDerived } from "@/state/store";
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
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";

interface DraftForm {
  name: string;
  brand: string;
  form: DosageForm;
  strength: string;
  qty: string;
  batchNo: string;
  expiry: string;
  mrp: string;
  cost: string;
  gst: string;
  mfr: string;
  rack: string;
  reorder: string;
  cls: string;
  sch: Schedule;
}

const BLANK: DraftForm = {
  name: "",
  brand: "",
  form: "Tablet",
  strength: "",
  qty: "",
  batchNo: "",
  expiry: "",
  mrp: "",
  cost: "",
  gst: "12",
  mfr: "",
  rack: "",
  reorder: "20",
  cls: "",
  sch: "OTC",
};

export function AddStockScreen() {
  const { stockIndex } = useDerived();
  const user = useCurrentUser();
  const actions = useActions();
  const toast = useToast();
  const maySeeCost = canDo(user, "viewCost");

  const [draft, setDraft] = useState<DraftForm>(BLANK);
  const [pending, setPending] = useState<readonly Batch[]>([]);
  const [error, setError] = useState("");
  const [customStrength, setCustomStrength] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const strengthOptions = useMemo(
    () => strengthsFor(draft.name, draft.form),
    [draft.name, draft.form],
  );

  /** Batches of this drug already on the shelf — context while receiving. */
  const onShelf = useMemo(() => {
    if (!draft.name.trim()) return [];
    const needle = draft.name.trim().toLowerCase();
    return stockIndex.all.filter(
      (b) =>
        b.name.toLowerCase() === needle &&
        (!draft.strength || b.strength === draft.strength),
    );
  }, [stockIndex, draft.name, draft.strength]);

  const pickFromCatalog = (hit: ProductHit) => {
    setDraft((d) => ({
      ...d,
      name: hit.name,
      form: hit.form,
      strength: hit.strength,
      brand: hit.drug.brands[0] ?? "",
      cls: hit.drug.cls,
      sch: hit.drug.sch,
    }));
    setCustomStrength(false);
  };

  /* -------------------------------------------------------- validation */

  const validate = (): string | null => {
    if (!draft.name.trim()) return "Enter the medicine name.";
    if (!draft.strength.trim()) return "Enter the strength.";
    if (!draft.qty || Number(draft.qty) <= 0) return "Enter the quantity received.";
    if (!draft.batchNo.trim()) return "Enter the batch number.";
    if (!draft.expiry) return "Enter the expiry date.";
    if (daysUntil(draft.expiry) < 0) return "That expiry date has already passed.";
    if (!draft.mrp || Number(draft.mrp) <= 0) return "Enter the MRP per unit.";
    if (Number(draft.cost) > Number(draft.mrp))
      return "Cost is higher than MRP — check the figures.";

    const dupOnShelf = findDuplicateBatch(stockIndex.all, draft.name, draft.batchNo);
    if (dupOnShelf) return `Batch ${draft.batchNo} of ${draft.name} is already on the shelf.`;

    const dupPending = findDuplicateBatch(pending, draft.name, draft.batchNo);
    if (dupPending) return `Batch ${draft.batchNo} is already in this list below.`;

    return null;
  };

  const addToList = () => {
    const problem = validate();
    if (problem) return setError(problem);

    const batch: Batch = {
      id: randomId(),
      name: draft.name.trim(),
      brand: draft.brand.trim(),
      form: draft.form,
      strength: draft.strength.trim(),
      qty: Number(draft.qty),
      batchNo: draft.batchNo.trim().toUpperCase(),
      expiry: draft.expiry,
      mrp: Number(draft.mrp),
      cost: Number(draft.cost || 0),
      gst: (Number(draft.gst) || 0) as GstRate,
      mfr: draft.mfr.trim(),
      rack: draft.rack.trim().toUpperCase(),
      reorder: Number(draft.reorder || 0),
      cls: draft.cls,
      sch: draft.sch,
      addedAt: new Date().toISOString(),
      addedBy: user.name,
    };

    setPending((list) => [...list, batch]);
    setError("");
    // Keep the form and rack — receiving a delivery means many rows in a row.
    setDraft({ ...BLANK, form: draft.form, rack: draft.rack, mfr: draft.mfr });
    setCustomStrength(false);
    toast.ok(`${batch.name} ${batch.strength} added to the list.`);
  };

  const saveAll = async () => {
    if (pending.length === 0) return setError("Add at least one batch first.");
    setBusy(true);
    await actions.receiveStock(pending);
    setBusy(false);
    toast.ok(
      `${pending.length} batch${pending.length === 1 ? "" : "es"} received into stock.`,
    );
    setPending([]);
  };

  const pendingValue = pending.reduce((n, b) => n + b.qty * (b.cost || b.mrp), 0);

  return (
    <Screen eyebrow="Goods inward" title="Receive stock">
      {error && <Banner tone="bad">{error}</Banner>}

      <Grid cols="split">
        <Stack>
          <Card title="Find the medicine" icon={Search} aside={<span className="sub">2+ letters, generic or brand</span>}>
            <MedicineSearch
              value={draft.name}
              onChange={(v) => set("name", v)}
              onPick={pickFromCatalog}
              autoFocus
              placeholder="Paracetamol, Dolo, Augmentin…"
            />

            {onShelf.length > 0 && (
              <div className="card" style={{ background: "var(--surface-2)" }}>
                <div className="card-h" style={{ padding: "8px 12px" }}>
                  <Package size={14} />
                  <span className="eyebrow">Already on shelf — {onShelf.length}</span>
                </div>
                <div className="scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Strength</th>
                        <th>Batch</th>
                        <th className="num">Qty</th>
                        <th>Expiry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {onShelf.map((b) => (
                        <tr key={b.id}>
                          <td>{b.strength}</td>
                          <td className="mono">{b.batchNo}</td>
                          <td className="num">{b.qty}</td>
                          <td>
                            <ExpiryTag date={b.expiry} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>

          <Card title="Batch details" icon={Pill}>
            <Grid cols={3}>
              <Field label="Medicine" required>
                {(id) => (
                  <Input
                    id={id}
                    list="catalog-generics"
                    value={draft.name}
                    placeholder="Paracetamol"
                    onChange={(e) => set("name", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Brand">
                {(id) => (
                  <Input
                    id={id}
                    value={draft.brand}
                    placeholder="Dolo"
                    onChange={(e) => set("brand", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Manufacturer">
                {(id) => (
                  <Input
                    id={id}
                    value={draft.mfr}
                    placeholder="Micro Labs"
                    onChange={(e) => set("mfr", e.target.value)}
                  />
                )}
              </Field>
            </Grid>

            <Grid cols={3}>
              <Field label="Form">
                {(id) => (
                  <Select
                    id={id}
                    value={draft.form}
                    onValueChange={(v) => {
                      set("form", v as DosageForm);
                      setCustomStrength(false);
                    }}
                    options={FORMS.map((f) => ({ value: f, label: f }))}
                  />
                )}
              </Field>

              <Field label="Strength" required>
                {(id) =>
                  strengthOptions.length > 0 && !customStrength ? (
                    <Select
                      id={id}
                      value={draft.strength}
                      placeholder="Select…"
                      onValueChange={(v) => {
                        if (v === "__other__") {
                          setCustomStrength(true);
                          set("strength", "");
                        } else {
                          set("strength", v);
                        }
                      }}
                      options={[
                        ...strengthOptions.map((s) => ({ value: s, label: s })),
                        { value: "__other__", label: "Other…" },
                      ]}
                    />
                  ) : (
                    <Input
                      id={id}
                      value={draft.strength}
                      placeholder="500 mg"
                      onChange={(e) => set("strength", e.target.value)}
                    />
                  )
                }
              </Field>

              <Field label={`Quantity (${packUnit(draft.form)})`} required>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    value={draft.qty}
                    placeholder="100"
                    onChange={(e) => set("qty", e.target.value)}
                  />
                )}
              </Field>
            </Grid>

            <Grid cols={3}>
              <Field label="Batch number" required>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.batchNo}
                    placeholder="DL2419"
                    style={{ textTransform: "uppercase" }}
                    onChange={(e) => set("batchNo", e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Expiry"
                required
                hint={draft.expiry ? `${daysUntil(draft.expiry)} days from today` : undefined}
                error={
                  draft.expiry && daysUntil(draft.expiry) < 0
                    ? "This date has already passed"
                    : null
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    min={toDateInput()}
                    value={draft.expiry}
                    onChange={(e) => set("expiry", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Rack">
                {(id) => (
                  <Input
                    id={id}
                    value={draft.rack}
                    placeholder="A-01"
                    style={{ textTransform: "uppercase" }}
                    onChange={(e) => set("rack", e.target.value)}
                  />
                )}
              </Field>
            </Grid>

            <Grid cols={4}>
              <Field label="MRP (₹)" required>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    step="0.01"
                    min={0}
                    value={draft.mrp}
                    onChange={(e) => set("mrp", e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Cost (₹)"
                hint={
                  !maySeeCost
                    ? "Pharmacist access only"
                    : draft.mrp && draft.cost
                      ? `${(((Number(draft.mrp) - Number(draft.cost)) / Number(draft.mrp)) * 100).toFixed(0)}% margin`
                      : undefined
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    step="0.01"
                    min={0}
                    disabled={!maySeeCost}
                    value={draft.cost}
                    onChange={(e) => set("cost", e.target.value)}
                  />
                )}
              </Field>
              <Field label="GST">
                {(id) => (
                  <Select
                    id={id}
                    value={draft.gst}
                    onValueChange={(v) => set("gst", v)}
                    options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))}
                  />
                )}
              </Field>
              <Field label="Reorder level" hint="Alert below this">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    value={draft.reorder}
                    onChange={(e) => set("reorder", e.target.value)}
                  />
                )}
              </Field>
            </Grid>

            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="primary" icon={Plus} style={{ flex: 1 }} onClick={addToList}>
                Add to list
              </Button>
              <Button
                variant="ghost"
                style={{ flex: 1 }}
                onClick={() => {
                  setDraft(BLANK);
                  setCustomStrength(false);
                  setError("");
                }}
              >
                Clear form
              </Button>
            </div>
          </Card>
        </Stack>

        <Card
          title="To be received"
          count={pending.length}
          padded={false}
          footer={
            pending.length > 0 ? (
              <>
                <Button
                  variant="primary"
                  icon={CheckCircle2}
                  busy={busy}
                  style={{ flex: 1 }}
                  onClick={saveAll}
                >
                  Save all
                </Button>
                <Button variant="ghost" style={{ flex: 1 }} onClick={() => setPending([])}>
                  Clear
                </Button>
              </>
            ) : undefined
          }
        >
          {pending.length === 0 ? (
            <div className="empty" style={{ padding: 30 }}>
              <Pill size={26} />
              <p style={{ margin: 0 }}>
                Add batches on the left. They're saved together in one go.
              </p>
            </div>
          ) : (
            <>
              <div className="scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Batch</th>
                      <th className="num">Qty</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{b.name}</div>
                          <div className="sub">
                            {b.strength} · {b.form}
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {b.batchNo}
                        </td>
                        <td className="num">{b.qty}</td>
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={X}
                            aria-label={`Remove ${b.name}`}
                            onClick={() => setPending((l) => l.filter((x) => x.id !== b.id))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {maySeeCost && (
                <div className="card-f" style={{ justifyContent: "space-between" }}>
                  <span className="eyebrow">Purchase value</span>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {formatMoney(pendingValue)}
                  </span>
                </div>
              )}
            </>
          )}
        </Card>
      </Grid>

      {/* Native autocomplete for the free-text name field. */}
      <datalist id="catalog-generics">
        {CATALOG.map((d) => (
          <option key={d.generic} value={d.generic} />
        ))}
      </datalist>
    </Screen>
  );
}
