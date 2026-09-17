/**
 * Generic sortable table.
 *
 * Every screen in the old build hand-wrote its own `<table className="tbl">`
 * plus a bespoke sort comparator. This is one implementation, typed against
 * whatever row shape you give it.
 */

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Empty } from "./primitives";
import type { LucideIcon } from "lucide-react";

export interface Column<T> {
  readonly key: string;
  readonly header: ReactNode;
  readonly render: (row: T) => ReactNode;
  /** Provide to make the column sortable. */
  readonly sortBy?: (row: T) => string | number;
  readonly align?: "left" | "right";
  readonly width?: number | string;
}

export interface DataTableProps<T> {
  readonly rows: readonly T[];
  readonly columns: readonly Column<T>[];
  readonly rowKey: (row: T) => string;
  /** Extra class on a row — used to flag expired batches red. */
  readonly rowClass?: (row: T) => string | undefined;
  readonly initialSort?: { key: string; dir: "asc" | "desc" };
  readonly emptyIcon?: LucideIcon;
  readonly emptyMessage?: string;
  readonly onRowClick?: (row: T) => void;
  /** Cap rendered rows; the caller shows its own "showing N of M" note. */
  readonly limit?: number;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowClass,
  initialSort,
  emptyIcon,
  emptyMessage = "Nothing to show.",
  onRowClick,
  limit,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortBy) return rows;

    const { sortBy } = column;
    const factor = sort.dir === "asc" ? 1 : -1;

    // Copy before sorting — `rows` may be state held elsewhere.
    return [...rows].sort((a, b) => {
      const av = sortBy(a);
      const bv = sortBy(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, columns, sort]);

  const visible = limit ? sorted.slice(0, limit) : sorted;

  const toggle = (key: string) =>
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );

  if (rows.length === 0) {
    return <Empty icon={emptyIcon}>{emptyMessage}</Empty>;
  }

  return (
    <div className="scroll">
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  style={{ width: c.width, textAlign: c.align === "right" ? "right" : "left" }}
                  className={c.sortBy ? "sortable" : undefined}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  onClick={c.sortBy ? () => toggle(c.key) : undefined}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {c.header}
                    {active &&
                      (sort.dir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr
              key={rowKey(row)}
              className={rowClass?.(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: "pointer" } : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.align === "right" ? "num" : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
