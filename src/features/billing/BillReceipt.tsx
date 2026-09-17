import { CheckCircle2, Printer } from "lucide-react";
import {
  computeTotals,
  formatDate,
  formatDateTime,
  formatMoney,
  type Bill,
} from "@/domain";
import { platform } from "@/platform";
import { Button, Modal } from "@/ui/primitives";

/**
 * Printable tax invoice.
 *
 * Adds a GST slab breakdown, which a compliant Indian tax invoice needs and the
 * old receipt didn't show, plus a VOID stamp for returned bills.
 */
export function BillReceipt({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const slabs = computeTotals(
    bill.lines.map((l) => ({ mrp: l.mrp, qty: l.qty, gst: l.gst })),
    bill.discountPct,
  ).gstBySlab;

  return (
    <Modal
      title={`Bill ${bill.no}`}
      icon={CheckCircle2}
      width={460}
      bare
      onClose={onClose}
      footer={
        <>
          {platform.printer.available && (
            <Button variant="primary" icon={Printer} onClick={() => platform.printer.print()}>
              Print
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="receipt print-me">
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 14, letterSpacing: ".06em" }}>
            {(bill.pharmacy || "HOSPITAL PHARMACY").toUpperCase()}
          </div>
          <div>Tax invoice — pharmacy counter</div>
        </div>

        {bill.status === "returned" && (
          <div className="void">RETURNED / VOID</div>
        )}

        <hr />
        <Line label="Bill no" value={bill.no} />
        <Line label="Date & time" value={formatDateTime(bill.at)} />
        <Line label="Patient" value={bill.patientName} />
        {bill.patientId && <Line label="Patient ID" value={bill.patientId} />}
        {bill.doctor && <Line label="Doctor" value={bill.doctor} />}
        <Line label="Dispensed by" value={bill.byName} />

        <hr />
        {bill.lines.map((l, i) => (
          <div key={`${l.batchId}-${i}`} style={{ marginBottom: 7 }}>
            <div>
              {i + 1}. {l.name} {l.strength}
            </div>
            <div style={{ color: "#555" }}>
              &nbsp;&nbsp;{l.form} · B/N {l.batchNo} · Exp {formatDate(l.expiry)}
            </div>
            <div className="row">
              <span>
                &nbsp;&nbsp;{l.qty} × {formatMoney(l.mrp)}
              </span>
              <span>{formatMoney(l.qty * l.mrp)}</span>
            </div>
          </div>
        ))}

        <hr />
        <Line label="Taxable value" value={formatMoney(bill.taxable)} />
        {slabs.map((s) => (
          <Line
            key={s.rate}
            label={`GST @ ${s.rate}% (CGST+SGST)`}
            value={formatMoney(s.gst)}
          />
        ))}
        <Line label="GST total" value={formatMoney(bill.gstTotal)} />
        {bill.discountAmt > 0 && (
          <Line
            label={`Discount (${bill.discountPct}%)`}
            value={`− ${formatMoney(bill.discountAmt)}`}
          />
        )}

        <hr />
        <div className="row" style={{ fontWeight: 600, fontSize: 14 }}>
          <span>PAYABLE</span>
          <span>{formatMoney(bill.net)}</span>
        </div>
        <Line label="Paid by" value={bill.pay} />
        {bill.payRef && <Line label="Reference" value={bill.payRef} />}

        {bill.status === "returned" && (
          <>
            <hr />
            <Line label="Returned" value={formatDateTime(bill.returnedAt ?? "")} />
            <Line label="Authorised by" value={bill.returnedBy ?? "—"} />
            {bill.returnReason && <Line label="Reason" value={bill.returnReason} />}
          </>
        )}

        <hr />
        <div style={{ textAlign: "center", color: "#555" }}>
          Medicines once sold are not returnable.
          <br />
          Check the expiry date before use.
        </div>
      </div>
    </Modal>
  );
}

const Line = ({ label, value }: { label: string; value: string }) => (
  <div className="row">
    <span>{label}</span>
    <span>{value}</span>
  </div>
);
