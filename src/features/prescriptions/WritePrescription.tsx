import { useMemo, useState } from "react";
import { Plus, Send, Stethoscope, X } from "lucide-react";

import {
  FREQUENCIES,
  availableQty,
  computeQty,
  makeItem,
  packUnit,
  validatePrescription,
  type DosageForm,
  type FrequencyCode,
  type PrescriptionDraft,
  type PrescriptionItem,
  type ProductHit,
} from "@/domain";
import { MedicineSearch } from "@/components/MedicineSearch";
import { useAppState, useDerived } from "@/state/store";
import {
  Banner,
  Button,
  Card,
  Field,
  Grid,
  Input,
  Modal,
  Select,
  Tag,
} from "@/ui/primitives";

/**
 * The doctor's prescription pad.
 *
 * Quantity is derived from dose × frequency × duration so nobody at the counter
 * has to do the arithmetic, and live stock is shown while prescribing — a
 * doctor who can see "0 on shelf" can pick an alternative before the patient
 * walks to the counter.
 */
export function WritePrescription({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (
    draft: PrescriptionDraft,
    items: readonly PrescriptionItem[],
  ) => Promise<void>;
}) {
  const { patients } = useAppState();
  const { stockIndex } = useDerived();

  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [patientAge, setPatientAge] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<readonly PrescriptionItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Current line being composed.
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ProductHit | null>(null);
  const [dose, setDose] = useState("1");
  const [frequency, setFrequency] = useState<FrequencyCode>("BD");
  const [duration, setDuration] = useState("5");
  const [instructions, setInstructions] = useState("");

  const previewQty = useMemo(
    () => computeQty(Number(dose) || 0, frequency, Number(duration) || 1),
    [dose, frequency, duration],
  );

  const pickedStock = useMemo(
    () => (picked ? availableQty(stockIndex, picked) : 0),
    [picked, stockIndex],
  );

  const addLine = () => {
    if (!picked) return setError("Search for and select a medicine first.");
    if (Number(dose) <= 0) return setError("Dose must be more than zero.");

    const item = makeItem({
      name: picked.name,
      form: picked.form,
      strength: picked.strength,
      dosePerTake: Number(dose),
      frequency,
      durationDays: Number(duration) || 1,
      instructions,
    });

    setItems((list) => [...list, item]);
    setError("");
    setPicked(null);
    setQuery("");
    setInstructions("");
  };

  const submit = async () => {
    const draft: PrescriptionDraft = {
      patientName,
      patientId,
      patientAge,
      diagnosis,
      notes,
    };
    const check = validatePrescription(draft, items);
    if (!check.ok) return setError(check.message);

    setBusy(true);
    await onSubmit(draft, items);
    setBusy(false);
  };

  return (
    <Modal
      title="Write a prescription"
      icon={Stethoscope}
      width={780}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="primary"
            icon={Send}
            busy={busy}
            disabled={items.length === 0 || !patientName.trim()}
            onClick={submit}
          >
            Send to pharmacy
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Discard
          </Button>
        </>
      }
    >
      {error && <Banner tone="bad">{error}</Banner>}

      <Grid cols={3}>
        <Field label="Patient name" required>
          {(id) => (
            <Input
              id={id}
              autoFocus
              list="registered-patients"
              value={patientName}
              placeholder="Ramesh Kumar"
              onChange={(e) => setPatientName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Patient ID" hint={`${patients.length} registered`}>
          {(id) => (
            <Input
              id={id}
              value={patientId}
              placeholder="PAT-12345"
              onChange={(e) => setPatientId(e.target.value)}
            />
          )}
        </Field>
        <Field label="Age">
          {(id) => (
            <Input
              id={id}
              value={patientAge}
              placeholder="42"
              onChange={(e) => setPatientAge(e.target.value)}
            />
          )}
        </Field>
      </Grid>

      <Field label="Diagnosis / indication">
        {(id) => (
          <Input
            id={id}
            value={diagnosis}
            placeholder="Acute bacterial pharyngitis"
            onChange={(e) => setDiagnosis(e.target.value)}
          />
        )}
      </Field>

      <Card title="Add a medicine" icon={Plus}>
        <MedicineSearch
          value={query}
          onChange={setQuery}
          onPick={(hit) => {
            setPicked(hit);
            setError("");
          }}
          placeholder="Search the formulary…"
        />

        {picked && (
          <>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                background: "var(--surface-2)",
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>
                  {picked.name} {picked.strength}
                </strong>
                <div className="sub">
                  {picked.form} · {picked.drug.cls}
                </div>
              </div>
              <Tag tone={pickedStock >= previewQty ? "ok" : pickedStock > 0 ? "warn" : "bad"}>
                {pickedStock} on shelf
              </Tag>
              <Button
                size="sm"
                variant="ghost"
                icon={X}
                aria-label="Clear"
                onClick={() => setPicked(null)}
              />
            </div>

            <Grid cols={4}>
              <Field label={`Units per dose`}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    step="0.5"
                    value={dose}
                    onChange={(e) => setDose(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Frequency">
                {(id) => (
                  <Select
                    id={id}
                    value={frequency}
                    onValueChange={(v) => setFrequency(v as FrequencyCode)}
                    options={FREQUENCIES.map((f) => ({ value: f.code, label: f.label }))}
                  />
                )}
              </Field>
              <Field label="Duration (days)">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    value={duration}
                    disabled={frequency === "STAT"}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Total to dispense" hint="Calculated">
                {(id) => (
                  <Input
                    id={id}
                    readOnly
                    className="mono"
                    value={`${previewQty} ${packUnit(picked.form)}`}
                  />
                )}
              </Field>
            </Grid>

            <Field label="Instructions to the patient">
              {(id) => (
                <Input
                  id={id}
                  value={instructions}
                  placeholder="After food, complete the full course"
                  onChange={(e) => setInstructions(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addLine()}
                />
              )}
            </Field>

            {pickedStock < previewQty && (
              <Banner tone="warn">
                Only {pickedStock} {packUnit(picked.form)} on the shelf against{" "}
                {previewQty} prescribed. You can still prescribe it — the counter
                will flag the shortfall.
              </Banner>
            )}

            <Button variant="primary" icon={Plus} onClick={addLine}>
              Add to prescription
            </Button>
          </>
        )}
      </Card>

      <Card
        title="Prescription"
        count={items.length}
        padded={false}
      >
        {items.length === 0 ? (
          <div className="empty" style={{ padding: 26 }}>
            <p style={{ margin: 0 }}>No medicines added yet.</p>
          </div>
        ) : (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Dosing</th>
                  <th className="num">Quantity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {index + 1}. {item.name}{" "}
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
                        {item.dosePerTake} × {item.durationDays}d
                      </div>
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {item.qty}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={X}
                        aria-label={`Remove ${item.name}`}
                        onClick={() =>
                          setItems((list) => list.filter((i) => i.id !== item.id))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Field label="Notes to the pharmacist">
        {(id) => (
          <Input
            id={id}
            value={notes}
            placeholder="Substitute generic if brand unavailable"
            onChange={(e) => setNotes(e.target.value)}
          />
        )}
      </Field>

      <datalist id="registered-patients">
        {patients.map((p) => (
          <option key={p.id} value={p.name}>
            {p.id}
          </option>
        ))}
      </datalist>
    </Modal>
  );
}

export type { DosageForm };
