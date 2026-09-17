/**
 * Small domain-aware display components. Shared by the inventory, expiry,
 * billing and dashboard screens.
 */

import { memo } from "react";
import {
  expiryStatus,
  formatDate,
  shelfLifeRemaining,
  type Batch,
  type IsoDate,
} from "@/domain";
import { Tag, type Tone } from "@/ui/primitives";

const TONE_FOR_LEVEL: Record<ReturnType<typeof expiryStatus>["level"], Tone> = {
  expired: "bad",
  critical: "bad",
  warning: "warn",
  ok: "ok",
};

export const ExpiryTag = memo(function ExpiryTag({ date }: { date: IsoDate }) {
  const status = expiryStatus(date);
  return <Tag tone={TONE_FOR_LEVEL[status.level]}>{status.label}</Tag>;
});

/** Expiry date plus its status tag — the pair every table shows together. */
export const ExpiryCell = memo(function ExpiryCell({ date }: { date: IsoDate }) {
  return (
    <>
      <div className="mono">{formatDate(date)}</div>
      <ExpiryTag date={date} />
    </>
  );
});

export const LifeBar = memo(function LifeBar({
  batch,
}: {
  batch: Pick<Batch, "expiry" | "addedAt">;
}) {
  const status = expiryStatus(batch.expiry);
  const fraction = shelfLifeRemaining(batch);
  // Always show a sliver so an expired batch still reads as a bar, not a gap.
  const pct = status.days <= 0 ? 100 : Math.max(4, fraction * 100);

  return (
    <div
      className={`life ${status.level}`}
      title={`${status.days} days remaining`}
      role="img"
      aria-label={`Shelf life: ${status.label}`}
    >
      <i style={{ width: `${pct}%` }} />
    </div>
  );
});

/** Medicine name over brand/form — repeated in six tables. */
export const DrugCell = memo(function DrugCell({
  name,
  strength,
  secondary,
}: {
  name: string;
  strength?: string;
  secondary?: string;
}) {
  return (
    <>
      <div style={{ fontWeight: 600 }}>
        {name}
        {strength && (
          <span className="mono" style={{ color: "var(--teal-d)", marginLeft: 6 }}>
            {strength}
          </span>
        )}
      </div>
      {secondary && <div className="sub">{secondary}</div>}
    </>
  );
});

export const ScheduleTag = memo(function ScheduleTag({ sch }: { sch: string }) {
  if (!sch || sch === "OTC") return null;
  return <Tag tone="info">Sch {sch}</Tag>;
});
