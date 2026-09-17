import { useState } from "react";
import { Database, Download, RotateCcw, Server, Upload } from "lucide-react";

import { canDo } from "@/domain";
import { platform } from "@/platform";
import { SCHEMA_VERSION } from "@/data/repository";
import { useActions, useAppState, useCurrentUser } from "@/state/store";
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Grid,
  Screen,
  Stat,
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { AppearanceCard } from "../settings/SettingsScreen";

/**
 * Data & backup — the administrator's half of what used to be "Settings".
 *
 * Personal preferences live here too, but subordinate to the thing that
 * actually matters at this level: where the data is and whether it's safe.
 */
export function DataScreen() {
  const { users, stock, bills, patients, prescriptions, audit } = useAppState();
  const me = useCurrentUser();
  const actions = useActions();
  const toast = useToast();

  const [confirmWipe, setConfirmWipe] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Screen eyebrow="Administration" title="Data & backup">
      {!platform.store.durable && (
        <Banner tone="bad">
          Storage is <strong>{platform.store.name}</strong> — records will not
          survive a reload. Export a backup before closing this tab.
        </Banner>
      )}

      <Card title="Where the data lives" icon={Server}>
        <Grid cols={2}>
          <Stat label="Backend" value={platform.store.name} />
          <Stat label="Schema version" value={SCHEMA_VERSION} />
        </Grid>

        <dl style={{ display: "grid", gap: 8, margin: 0 }}>
          <Detail label="Platform" value={platform.id} />
          <Detail
            label="Survives restart"
            value={platform.store.durable ? "Yes" : "No — memory only"}
          />
          <Detail label="Password hashing" value={platform.crypto.algorithm} />
          <Detail
            label="Secure context"
            value={platform.crypto.available ? "Yes" : "No — sign-in will fail"}
          />
        </dl>

        <Banner tone="info">
          Data lives on <strong>this device only</strong>. Another machine gets
          its own separate pharmacy. To share one dataset across the store room
          and the counter, run the bundled PostgreSQL backend — see{" "}
          <code>server/README.md</code>.
        </Banner>
      </Card>

      <Card title="Record counts" icon={Database}>
        <Grid cols={3}>
          <Stat label="Staff accounts" value={users.length} />
          <Stat label="Stock batches" value={stock.length} />
          <Stat label="Bills" value={bills.length} />
          <Stat label="Prescriptions" value={prescriptions.length} />
          <Stat label="Patients" value={patients.length} />
          <Stat label="Audit entries" value={audit.length} />
        </Grid>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            icon={Download}
            disabled={!canDo(me, "exportData")}
            onClick={async () => {
              await actions.exportSnapshot();
              toast.ok("Backup downloaded.");
            }}
          >
            Export full backup (JSON)
          </Button>

          <Button
            icon={Upload}
            busy={busy}
            disabled={!canDo(me, "importData") || !platform.files.canOpen}
            onClick={async () => {
              setBusy(true);
              const problem = await actions.importSnapshot();
              setBusy(false);
              if (problem) toast.error(problem);
              else toast.ok("Backup restored.");
            }}
          >
            Restore from backup
          </Button>

          <Button
            variant="danger"
            icon={RotateCcw}
            disabled={!canDo(me, "wipeData")}
            onClick={() => setConfirmWipe(true)}
          >
            Wipe operational data
          </Button>
        </div>
      </Card>

      <AppearanceCard />

      {confirmWipe && (
        <ConfirmDialog
          title="Wipe stock, bills, prescriptions and patients"
          confirmWord="WIPE"
          confirmLabel="Wipe data"
          body={
            <div>
              <p style={{ marginTop: 0 }}>
                This clears {stock.length} batches, {bills.length} bills,{" "}
                {prescriptions.length} prescriptions and {patients.length}{" "}
                patients. Staff accounts and the audit log are kept.
              </p>
              <Banner tone="bad">
                There is no undo. Export a backup first if you might want this
                data back.
              </Banner>
            </div>
          }
          onCancel={() => setConfirmWipe(false)}
          onConfirm={async () => {
            await actions.wipeData();
            toast.warn("Operational data cleared.");
            setConfirmWipe(false);
          }}
        />
      )}
    </Screen>
  );
}

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
    <dt className="eyebrow" style={{ margin: 0 }}>
      {label}
    </dt>
    <dd className="mono" style={{ margin: 0, fontSize: 12, textAlign: "right" }}>
      {value}
    </dd>
  </div>
);
