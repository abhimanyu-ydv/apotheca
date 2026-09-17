import { useMemo, useState } from "react";
import { Download, ScrollText } from "lucide-react";

import {
  AUDIT_LABELS,
  AUDIT_LIMIT,
  SENSITIVE_ACTIONS,
  auditCsv,
  filterAudit,
  formatDateTime,
  type AuditAction,
  type AuditEntry,
} from "@/domain";
import { useActions, useAppState } from "@/state/store";
import { DataTable, type Column } from "@/ui/DataTable";
import {
  Banner,
  Button,
  Card,
  Grid,
  Screen,
  SearchInput,
  Select,
  Stat,
  Tag,
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";

/**
 * Audit log viewer. Entirely new — the old build kept no record of who changed
 * what, which is the first thing a drug inspector asks for.
 */
export function AuditScreen() {
  const { audit } = useAppState();
  const actions = useActions();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [action, setAction] = useState<AuditAction | "All">("All");

  const rows = useMemo(() => filterAudit(audit, query, action), [audit, query, action]);

  const sensitiveCount = useMemo(
    () => audit.filter((e) => SENSITIVE_ACTIONS.has(e.action)).length,
    [audit],
  );

  const actorCount = useMemo(
    () => new Set(audit.map((e) => e.actorId)).size,
    [audit],
  );

  const columns: Column<AuditEntry>[] = [
    {
      key: "at",
      header: "When",
      sortBy: (e) => e.at,
      width: 190,
      render: (e) => (
        <span className="mono" style={{ fontSize: 11 }}>
          {formatDateTime(e.at)}
        </span>
      ),
    },
    {
      key: "actor",
      header: "Who",
      sortBy: (e) => e.actorName,
      render: (e) => e.actorName,
    },
    {
      key: "action",
      header: "Action",
      sortBy: (e) => e.action,
      render: (e) => (
        <Tag tone={SENSITIVE_ACTIONS.has(e.action) ? "bad" : "neutral"}>
          {AUDIT_LABELS[e.action] ?? e.action}
        </Tag>
      ),
    },
    { key: "summary", header: "Details", render: (e) => e.summary },
  ];

  return (
    <Screen
      eyebrow="Compliance"
      title="Audit log"
      actions={
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search details or person…"
            minWidth={260}
          />
          <Select
            value={action}
            onValueChange={(v) => setAction(v as AuditAction | "All")}
            className="control"
            style={{ width: "auto" }}
            options={[
              { value: "All", label: "All actions" },
              ...(Object.keys(AUDIT_LABELS) as AuditAction[]).map((a) => ({
                value: a,
                label: AUDIT_LABELS[a],
              })),
            ]}
          />
          <Button
            icon={Download}
            disabled={rows.length === 0}
            onClick={() => {
              void actions.exportCsv(
                `apotheca-audit-${new Date().toISOString().slice(0, 10)}.csv`,
                auditCsv(rows),
              );
              toast.ok(`Exported ${rows.length} entries.`);
            }}
          >
            CSV
          </Button>
        </>
      }
    >
      <Banner tone="info">
        Every stock movement, bill, return and account change is recorded here
        with the person responsible. The log keeps the most recent{" "}
        {AUDIT_LIMIT.toLocaleString("en-IN")} entries — export regularly if you
        need to keep more.
      </Banner>

      <Grid cols={3}>
        <Stat label="Entries recorded" value={audit.length} />
        <Stat
          label="Sensitive actions"
          value={sensitiveCount}
          sub="Deletes, write-offs, returns, wipes"
          tone={sensitiveCount ? "warn" : "neutral"}
        />
        <Stat label="People involved" value={actorCount} />
      </Grid>

      <Card padded={false}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(e) => e.id}
          emptyIcon={ScrollText}
          emptyMessage="Nothing recorded yet."
          limit={500}
        />
        {rows.length > 500 && (
          <div className="card-f">
            <span className="sub">
              Showing the 500 most recent of {rows.length} matching entries. Export
              to CSV for the rest.
            </span>
          </div>
        )}
      </Card>
    </Screen>
  );
}
