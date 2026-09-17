import { useMemo } from "react";
import { CheckCircle2, Clock, FileText, Stethoscope } from "lucide-react";

import {
  checkAvailability,
  formatDateTime,
  friendlyName,
  pendingQueue,
  type Feature,
  type Prescription,
} from "@/domain";
import { useAppState, useCurrentUser, useDerived } from "@/state/store";
import { Banner, Button, Card, Empty, Grid, Screen, Stat, Tag } from "@/ui/primitives";

/**
 * The doctor's own activity — not the pharmacy's. Deliberately narrow: what
 * have I written, what is still waiting at the counter, what got filled.
 */
export function DoctorHome({ go }: { go: (f: Feature) => void }) {
  const { prescriptions } = useAppState();
  const { stockIndex } = useDerived();
  const user = useCurrentUser();

  const mine = useMemo(
    () => prescriptions.filter((rx) => rx.doctorId === user.id),
    [prescriptions, user.id],
  );

  const waiting = useMemo(() => pendingQueue(mine), [mine]);
  const dispensed = useMemo(() => mine.filter((rx) => rx.status === "dispensed"), [mine]);

  /** Waiting prescriptions the pharmacy can't fully fill — worth knowing early. */
  const blocked = useMemo(
    () =>
      waiting
        .map((rx) => ({ rx, check: checkAvailability(rx, stockIndex) }))
        .filter(({ check }) => check.level !== "full"),
    [waiting, stockIndex],
  );

  const recent = useMemo(
    () => [...mine].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8),
    [mine],
  );

  return (
    <Screen
      eyebrow="Clinical"
      title={`Dr ${friendlyName(user.name)} — ${user.department || "your activity"}`}
      actions={
        <Button variant="primary" icon={Stethoscope} onClick={() => go("prescriptions")}>
          Prescription pad
        </Button>
      }
    >
      {blocked.length > 0 && (
        <Banner tone="warn">
          <strong>
            {blocked.length} of your waiting prescription
            {blocked.length === 1 ? "" : "s"} can't be filled completely.
          </strong>{" "}
          The pharmacy is short on:{" "}
          {[
            ...new Set(
              blocked.flatMap(({ check }) =>
                check.lines.filter((l) => l.shortfall > 0).map((l) => l.item.name),
              ),
            ),
          ]
            .slice(0, 4)
            .join(", ")}
          .
        </Banner>
      )}

      <Grid cols={4}>
        <Stat label="Written by me" value={mine.length} />
        <Stat
          label="Waiting at the counter"
          value={waiting.length}
          tone={waiting.length ? "warn" : "neutral"}
          onClick={() => go("prescriptions")}
        />
        <Stat label="Dispensed" value={dispensed.length} tone="ok" />
        <Stat
          label="Short on stock"
          value={blocked.length}
          tone={blocked.length ? "bad" : "ok"}
        />
      </Grid>

      <Grid cols={2}>
        <Card
          title="Still waiting"
          icon={Clock}
          count={waiting.length}
          padded={false}
          aside={
            <Button size="sm" variant="ghost" onClick={() => go("prescriptions")}>
              Open pad
            </Button>
          }
        >
          {waiting.length === 0 ? (
            <Empty icon={CheckCircle2}>Nothing of yours is waiting. All filled.</Empty>
          ) : (
            <RxTable rows={waiting} />
          )}
        </Card>

        <Card title="Recently filled" icon={CheckCircle2} padded={false}>
          {dispensed.length === 0 ? (
            <Empty icon={FileText}>Nothing dispensed yet.</Empty>
          ) : (
            <RxTable rows={dispensed.slice(0, 6)} showBill />
          )}
        </Card>
      </Grid>

      <Card title="Everything you've written" icon={FileText} padded={false}>
        {recent.length === 0 ? (
          <Empty icon={Stethoscope}>
            You haven't written a prescription yet. Open the pad to start one.
          </Empty>
        ) : (
          <RxTable rows={recent} showBill showStatus />
        )}
      </Card>
    </Screen>
  );
}

function RxTable({
  rows,
  showBill,
  showStatus,
}: {
  rows: readonly Prescription[];
  showBill?: boolean;
  showStatus?: boolean;
}) {
  return (
    <div className="scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>Rx</th>
            <th>Patient</th>
            <th className="num">Items</th>
            {showStatus && <th>Status</th>}
            {showBill && <th>Bill</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((rx) => (
            <tr key={rx.id}>
              <td>
                <div className="mono" style={{ fontWeight: 600, fontSize: 11 }}>
                  {rx.id}
                </div>
                <div className="sub">{formatDateTime(rx.at)}</div>
              </td>
              <td>
                <div style={{ fontWeight: 600 }}>{rx.patientName}</div>
                {rx.diagnosis && <div className="sub">{rx.diagnosis}</div>}
              </td>
              <td className="num">{rx.items.length}</td>
              {showStatus && (
                <td>
                  <Tag
                    tone={
                      rx.status === "dispensed"
                        ? "ok"
                        : rx.status === "cancelled"
                          ? "bad"
                          : "warn"
                    }
                  >
                    {rx.status}
                  </Tag>
                </td>
              )}
              {showBill && (
                <td className="mono" style={{ fontSize: 11 }}>
                  {rx.billNo ?? "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
