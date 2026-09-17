import { useMemo } from "react";
import {
  CalendarClock,
  Package,
  Receipt,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";

import {
  bucketByExpiry,
  formatMoney,
  formatMoneyShort,
  formatTime,
  friendlyName,
  isLowStock,
  isSameDay,
  packUnit,
  reorderReport,
  retailValue,
  stockValue,
  summarise,
  topMovers,
  writeOffValue,
  type Feature,
} from "@/domain";
import { DrugCell, ExpiryTag, LifeBar } from "@/components/ExpiryBits";
import { useAppState, useCurrentUser, useDerived } from "@/state/store";
import {
  Banner,
  Button,
  Card,
  Empty,
  Grid,
  Screen,
  Stack,
  Stat,
} from "@/ui/primitives";

export function DashboardScreen({ go }: { go: (feature: Feature) => void }) {
  const { bills } = useAppState();
  const { stockIndex } = useDerived();
  const user = useCurrentUser();

  const stats = useMemo(() => {
    const stock = stockIndex.all;
    const buckets = bucketByExpiry(stock);
    const now = new Date();

    const todayBills = bills.filter((b) => b.status === "issued" && isSameDay(b.at, now));
    const low = stock.filter((b) => isLowStock(b) && !buckets.expired.includes(b));

    return {
      buckets,
      low,
      today: summarise(todayBills),
      todayBills,
      cost: stockValue(stock),
      retail: retailValue(stock),
      expiredLoss: writeOffValue(buckets.expired),
      reorder: reorderReport(stockIndex),
      movers: topMovers(bills, 5),
    };
  }, [stockIndex, bills]);

  const attention =
    stats.buckets.expired.length + stats.buckets.critical.length + stats.low.length;

  const soonest = useMemo(
    () => [...stats.buckets.critical, ...stats.buckets.warning].slice(0, 6),
    [stats.buckets],
  );

  const recentBills = useMemo(
    () => [...bills].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5),
    [bills],
  );

  return (
    <Screen
      eyebrow="Welcome"
      title={`Hi ${friendlyName(user.name)} — ${user.role}`}
    >
      {stats.buckets.expired.length > 0 && (
        <Banner tone="bad">
          {stats.buckets.expired.length} expired batch
          {stats.buckets.expired.length === 1 ? "" : "es"} on the shelf, worth{" "}
          {formatMoney(stats.expiredLoss)}.{" "}
          <button
            className="link"
            style={{ color: "inherit", textDecoration: "underline" }}
            onClick={() => go("expiry")}
          >
            Open the expiry desk
          </button>
        </Banner>
      )}

      <Grid cols={4}>
        <Stat
          label="Batches on shelf"
          value={stockIndex.all.length}
          sub={`${formatMoneyShort(stats.retail)} at MRP`}
          onClick={() => go("inventory")}
        />
        <Stat label="Stock value (cost)" value={formatMoneyShort(stats.cost)} />
        <Stat
          label="Today's sales"
          value={formatMoney(stats.today.gross)}
          sub={`${stats.today.count} bill${stats.today.count === 1 ? "" : "s"}`}
          onClick={() => go("bills")}
        />
        <Stat
          label="Needs attention"
          value={attention}
          sub={`${stats.buckets.expired.length} expired · ${stats.low.length} low`}
          tone={stats.buckets.expired.length ? "bad" : attention ? "warn" : "ok"}
          onClick={() => go("expiry")}
        />
      </Grid>

      <Grid cols={2}>
        <Card
          title="Expiring soonest"
          icon={CalendarClock}
          padded={false}
          aside={
            <Button size="sm" variant="ghost" onClick={() => go("expiry")}>
              View all
            </Button>
          }
        >
          {soonest.length === 0 ? (
            <Empty icon={CalendarClock}>Nothing expiring in the next 90 days.</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <tbody>
                  {soonest.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <DrugCell
                          name={b.name}
                          strength={b.strength}
                          secondary={`B/N ${b.batchNo} · ${b.qty} ${packUnit(b.form)}`}
                        />
                      </td>
                      <td style={{ width: 90 }}>
                        <LifeBar batch={b} />
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

        <Card
          title="Reorder list"
          icon={ShoppingCart}
          count={stats.reorder.length}
          padded={false}
          aside={
            <Button size="sm" variant="ghost" onClick={() => go("inventory")}>
              Inventory
            </Button>
          }
        >
          {stats.reorder.length === 0 ? (
            <Empty icon={Package}>Everything is above its reorder level.</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th className="num">On hand</th>
                    <th className="num">Short by</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.reorder.slice(0, 6).map((r) => (
                    <tr key={r.key}>
                      <td>
                        <DrugCell
                          name={r.name}
                          strength={r.strength}
                          secondary={`${r.form}${r.rack ? ` · rack ${r.rack}` : ""}`}
                        />
                      </td>
                      <td className="num" style={{ color: "var(--amber)", fontWeight: 600 }}>
                        {r.onHand}
                      </td>
                      <td className="num">{r.deficit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Grid>

      <Grid cols={2}>
        <Card
          title="Latest bills"
          icon={Receipt}
          padded={false}
          aside={
            <Button size="sm" variant="ghost" onClick={() => go("bills")}>
              View all
            </Button>
          }
        >
          {recentBills.length === 0 ? (
            <Empty icon={Receipt}>No bills issued yet.</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Bill</th>
                    <th>Patient</th>
                    <th className="num">Items</th>
                    <th className="num">Time</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBills.map((b) => (
                    <tr key={b.id}>
                      <td className="mono" style={{ fontWeight: 600, fontSize: 11 }}>
                        {b.no}
                      </td>
                      <td>{b.patientName}</td>
                      <td className="num">{b.lines.length}</td>
                      <td className="num" style={{ fontSize: 11 }}>
                        {formatTime(b.at)}
                      </td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {formatMoney(b.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Fastest movers" icon={TrendingUp} padded={false}>
          {stats.movers.length === 0 ? (
            <Empty icon={TrendingUp}>Dispense a few bills to see what moves.</Empty>
          ) : (
            <Stack gap={0}>
              <div className="scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th className="num">Units dispensed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.movers.map((m) => (
                      <tr key={m.key}>
                        <td>
                          <DrugCell name={m.name} strength={m.strength} />
                        </td>
                        <td className="num" style={{ fontWeight: 600 }}>
                          {m.units}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Stack>
          )}
        </Card>
      </Grid>
    </Screen>
  );
}
