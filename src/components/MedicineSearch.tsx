/**
 * Type-ahead over the formulary.
 *
 * Reads from the prebuilt stock index and a debounced query, so a keystroke no
 * longer rebuilds the drug × form × strength cross-product.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  MIN_QUERY_LENGTH,
  formatDate,
  packUnit,
  searchProducts,
  type ProductHit,
} from "@/domain";
import { useDebounced } from "@/hooks";
import { useDerived } from "@/state/store";
import { Tag } from "@/ui/primitives";

export interface MedicineSearchProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onPick: (hit: ProductHit) => void;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  /** Hide products with nothing dispensable — used at the billing counter. */
  readonly inStockOnly?: boolean;
}

export function MedicineSearch({
  value,
  onChange,
  onPick,
  placeholder = "Type a medicine or brand…",
  autoFocus,
  inStockOnly = false,
}: MedicineSearchProps) {
  const { stockIndex } = useDerived();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useRef(`ms-${Math.random().toString(36).slice(2, 8)}`).current;

  const query = useDebounced(value, 140);

  const results = useMemo(
    () => searchProducts(query, stockIndex, { inStockOnly }),
    [query, stockIndex, inStockOnly],
  );

  useEffect(() => setHighlight(0), [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const choose = (hit: ProductHit) => {
    onPick(hit);
    setOpen(false);
  };

  const showList = open && value.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="sugg-wrap" ref={wrapRef}>
      <div className="search-wrap">
        <Search size={15} className="icon" />
        <input
          className="control"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showList || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              const hit = results[highlight];
              if (hit) {
                e.preventDefault();
                choose(hit);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>

      {showList && (
        <div className="sugg" id={listId} role="listbox">
          {results.length === 0 ? (
            <div style={{ padding: 14, color: "var(--muted)", fontSize: 13 }}>
              No match in the formulary. You can still enter it by hand below.
            </div>
          ) : (
            <>
              <div className="sugg-h eyebrow">
                {results.length} match{results.length === 1 ? "" : "es"}
              </div>
              {results.map((hit, i) => (
                <button
                  key={hit.key}
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  className={`sugg-i ${i === highlight ? "hi" : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(hit)}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontWeight: 600, display: "block" }}>
                      {hit.name}{" "}
                      <span className="mono" style={{ color: "var(--teal-d)" }}>
                        {hit.strength}
                      </span>
                      <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                        {" "}
                        · {hit.form}
                      </span>
                    </span>
                    <span className="sub">
                      {hit.drug.brands.slice(0, 3).join(" · ")} — {hit.drug.cls}
                    </span>
                  </span>
                  <span style={{ textAlign: "right", flexShrink: 0 }}>
                    {hit.qty > 0 ? (
                      <>
                        <span
                          className="mono"
                          style={{ fontSize: 12.5, fontWeight: 600, display: "block" }}
                        >
                          {hit.qty} {packUnit(hit.form)}
                        </span>
                        {hit.nearest && (
                          <span className="sub" style={{ fontSize: 10.5 }}>
                            exp {formatDate(hit.nearest.expiry)}
                          </span>
                        )}
                      </>
                    ) : (
                      <Tag>Out</Tag>
                    )}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
