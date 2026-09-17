import { useMemo } from "react";
import { Boxes, CalendarClock, Package, Printer } from "lucide-react";

import {
  bucketByExpiry,
  formatDate,
  formatTime,
  isLowStock,
  isSameDay,
  packUnit,
  type Feature,
} from "@/domain";
import { DrugCell, ExpiryTag } from "@/components/ExpiryBits";
import { useAppState, useCurrentUser, useDerived } from "@/state/store";
import { Button, Card, Empty, Grid, Screen, Stat } from "@/ui/primitives";

/**
 * Ward overview.
 *
 * No money, no cost, no stock value — a nurse's questions are "is it on the
 * shelf" and "did this patient get theirs".
 */
export function WardHome({ go }: { go: (f: Feature) => void }) {
  const { bills } = useAppState();
  const { stockIndex } = useDerived();
  const user = useCurrentUser();

  const stats = useMemo(() => {
    const buckets = bucketByExpiry(stockIndex.all);
    const dispensable = stockIndex.all.filter(
      (b) => b.qty > 0 && !buckets.expired.includes(b),
    );
    const low = dispensable.filter(isLowStock);
    const todaysBills = bills.filter(
      (b) => b.status === "issued" && isSameDay(b.at, new Date()),
    );
    return { buckets, dispensable, low, todaysBills };
  }, [stockIndex, bills]);

  return (
    <Screen
      eyebrow="Ward"
      title={`${user.department || "Ward"} overview`}
      actions={
        <Button icon={Boxes} onClick={() => go("inventory")}>
          Check availability
        </Button>
      }
    >
      <Grid cols={4}>
        <Stat
          label="Available now"
          value={stats.dispensable.length}
          sub="batches not expired"
          onClick={() => go("inventory")}
        />
        <Stat
          label="Running low"
          value={stats.low.length}
          tone={stats.low.length ? "warn" : "ok"}
        />
        <Stat
          label="Expiring within 30 days"
          value={stats.buckets.critical.length}
          tone={stats.buckets.critical.length ? "warn" : "neutral"}
        />
        <Stat
          label="Dispensed today"
          value={stats.todaysBills.length}
          sub="patients served"
          onClick={() => go("bills")}
        />
      </Grid>

      <Grid cols={2}>
        <Card
          title="Running low — ask the pharmacy"
          icon={Package}
          count={stats.low.length}
          padded={false}
        >
          {stats.low.length === 0 ? (
            <Empty icon={Package}>Everything is above its reorder level.</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Rack</th>
                    <th className="num">On shelf</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.low.slice(0, 8).map((b) => (
                    <tr key={b.id}>
                      <td>
                        <DrugCell
                          name={b.name}
                          strength={b.strength}
                          secondary={`${b.brand || "—"} · ${b.form}`}
                        />
                      </td>
                      <td className="mono">{b.rack || "—"}</td>
                      <td className="num" style={{ color: "var(--amber)", fontWeight: 600 }}>
                        {b.qty} {packUnit(b.form)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Expiring soon — use these first"
          icon={CalendarClock}
          count={stats.buckets.critical.length}
          padded={false}
        >
          {stats.buckets.critical.length === 0 ? (
            <Empty icon={CalendarClock}>Nothing expiring this month.</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <tbody>
                  {stats.buckets.critical.slice(0, 8).map((b) => (
                    <tr key={b.id}>
                      <td>
                        <DrugCell
                          name={b.name}
                          strength={b.strength}
                          secondary={`B/N ${b.batchNo} · ${b.qty} ${packUnit(b.form)}`}
                        />
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {formatDate(b.expiry)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <ExpiryTag date={b.expiry} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Grid>

      <Card
        title="Dispensed today"
        icon={Printer}
        count={stats.todaysBills.length}
        padded={false}
        aside={
          <Button size="sm" variant="ghost" onClick={() => go("bills")}>
            Full record
          </Button>
        }
      >
        {stats.todaysBills.length === 0 ? (
          <Empty icon={Printer}>Nothing dispensed yet today.</Empty>
        ) : (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th className="num">Items</th>
                </tr>
              </thead>
              <tbody>
                {stats.todaysBills.slice(0, 10).map((b) => (
                  <tr key={b.id}>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {formatTime(b.at)}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{b.patientName}</div>
                      {b.patientId && <div className="sub mono">{b.patientId}</div>}
                    </td>
                    <td>{b.doctor || "—"}</td>
                    <td className="num">{b.lines.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Screen>
  );
}
