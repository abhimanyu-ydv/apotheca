import { useMemo } from "react";
import {
  AlertTriangle,
  Database,
  ScrollText,
  ShieldAlert,
  Stethoscope,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  AUDIT_LABELS,
  ROLE_LIST,
  SENSITIVE_ACTIONS,
  bucketByExpiry,
  formatDateTime,
  formatMoney,
  formatMoneyShort,
  isSameDay,
  pendingQueue,
  stockValue,
  summarise,
  topMovers,
  writeOffValue,
  type Feature,
} from "@/domain";
import { platform } from "@/platform";
import { DrugCell } from "@/components/ExpiryBits";
import { useAppState, useDerived } from "@/state/store";
import { Banner, Button, Card, Empty, Grid, Screen, Stat, Tag } from "@/ui/primitives";

/**
 * Administrator overview.
 *
 * Answers the questions only the Chief Pharmacist has to answer: who is on the
 * system, what did they do, is anything unsafe, and is the data backed up.
 * Trading numbers are here too, but they are not the top of the page.
 */
export function AdminHome({ go }: { go: (f: Feature) => void }) {
  const { users, bills, prescriptions, audit, patients } = useAppState();
  const { stockIndex } = useDerived();

  const stats = useMemo(() => {
    const buckets = bucketByExpiry(stockIndex.all);
    const today = bills.filter((b) => b.status === "issued" && isSameDay(b.at, new Date()));
    return {
      buckets,
      today: summarise(today),
      allTime: summarise(bills),
      value: stockValue(stockIndex.all),
      loss: writeOffValue(buckets.expired),
      waiting: pendingQueue(prescriptions).length,
      movers: topMovers(bills, 5),
      returned: bills.filter((b) => b.status === "returned").length,
    };
  }, [stockIndex, bills, prescriptions]);

  const staff = useMemo(
    () => ({
      active: users.filter((u) => u.active).length,
      disabled: users.filter((u) => !u.active).length,
      pending: users.filter((u) => u.mustChangePassword && u.active).length,
      neverSignedIn: users.filter((u) => !u.lastLoginAt).length,
      byRole: ROLE_LIST.map((r) => ({
        role: r.name,
        colour: r.colour,
        count: users.filter((u) => u.role === r.name).length,
      })),
    }),
    [users],
  );

  const sensitive = useMemo(
    () => audit.filter((e) => SENSITIVE_ACTIONS.has(e.action)).slice(0, 8),
    [audit],
  );

  return (
    <Screen
      eyebrow="Administration"
      title="Pharmacy overview"
      actions={
        <>
          <Button icon={Users} onClick={() => go("staff")}>
            Staff & access
          </Button>
          <Button icon={Database} onClick={() => go("settings")}>
            Data & backup
          </Button>
        </>
      }
    >
      {!platform.store.durable && (
        <Banner tone="bad" icon={AlertTriangle}>
          Storage is <strong>{platform.store.name}</strong> — nothing will survive
          a reload. Export a backup before you close this tab.
        </Banner>
      )}

      {staff.pending > 0 && (
        <Banner tone="info" icon={Users}>
          {staff.pending} issued account{staff.pending === 1 ? "" : "s"} still on
          the temporary password.{" "}
          <button
            className="link"
            style={{ color: "inherit", textDecoration: "underline" }}
            onClick={() => go("staff")}
          >
            Review staff
          </button>
        </Banner>
      )}

      {/* --- the administrator's own beat --- */}
      <Grid cols={4}>
        <Stat label="Active accounts" value={staff.active} sub={`${staff.disabled} disabled`} onClick={() => go("staff")} />
        <Stat
          label="Awaiting first sign-in"
          value={staff.neverSignedIn}
          tone={staff.neverSignedIn ? "warn" : "ok"}
          onClick={() => go("staff")}
        />
        <Stat label="Audit entries" value={audit.length} onClick={() => go("audit")} />
        <Stat
          label="Sensitive actions"
          value={audit.filter((e) => SENSITIVE_ACTIONS.has(e.action)).length}
          sub="deletes, write-offs, returns"
          tone={sensitive.length ? "warn" : "neutral"}
          onClick={() => go("audit")}
        />
      </Grid>

      <Grid cols={2}>
        <Card title="Who's on the system" icon={Users}>
          <div style={{ display: "grid", gap: 8 }}>
            {staff.byRole.map((r) => (
              <div
                key={r.role}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 10px",
                  background: "var(--surface-2)",
                  borderLeft: `3px solid ${r.colour}`,
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <span style={{ fontWeight: 600, flex: 1 }}>{r.role}</span>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {r.count}
                </span>
              </div>
            ))}
          </div>
          <Button size="sm" icon={Users} onClick={() => go("staff")}>
            Issue an account
          </Button>
        </Card>

        <Card
          title="Recent sensitive actions"
          icon={ShieldAlert}
          padded={false}
          aside={
            <Button size="sm" variant="ghost" onClick={() => go("audit")}>
              Full log
            </Button>
          }
        >
          {sensitive.length === 0 ? (
            <Empty icon={ScrollText}>
              Nothing destructive has happened. That's the good outcome.
            </Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <tbody>
                  {sensitive.map((e) => (
                    <tr key={e.id}>
                      <td style={{ width: 150 }}>
                        <Tag tone="bad">{AUDIT_LABELS[e.action] ?? e.action}</Tag>
                        <div className="sub mono" style={{ fontSize: 10.5 }}>
                          {formatDateTime(e.at)}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 12.5 }}>{e.summary}</div>
                        <div className="sub">{e.actorName}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Grid>

      {/* --- trading position --- */}
      <Grid cols={4}>
        <Stat label="Stock value (cost)" value={formatMoneyShort(stats.value)} />
        <Stat
          label="Today's revenue"
          value={formatMoney(stats.today.gross)}
          sub={`${stats.today.count} bills`}
          onClick={() => go("bills")}
        />
        <Stat
          label="All-time revenue"
          value={formatMoneyShort(stats.allTime.gross)}
          sub={`GST ${formatMoneyShort(stats.allTime.gst)}`}
        />
        <Stat
          label="Expired write-off risk"
          value={formatMoney(stats.loss)}
          tone={stats.buckets.expired.length ? "bad" : "ok"}
          sub={`${stats.buckets.expired.length} batches`}
          onClick={() => go("expiry")}
        />
      </Grid>

      <Grid cols={2}>
        <Card title="Operational load" icon={Stethoscope}>
          <Grid cols={2}>
            <Stat label="Rx waiting" value={stats.waiting} tone={stats.waiting ? "warn" : "ok"} />
            <Stat label="Bills returned" value={stats.returned} tone={stats.returned ? "warn" : "neutral"} />
            <Stat label="Patients registered" value={patients.length} />
            <Stat label="Batches on shelf" value={stockIndex.all.length} />
          </Grid>
        </Card>

        <Card title="Fastest movers" icon={TrendingUp} padded={false}>
          {stats.movers.length === 0 ? (
            <Empty icon={TrendingUp}>No dispensing yet.</Empty>
          ) : (
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
          )}
        </Card>
      </Grid>
    </Screen>
  );
}
