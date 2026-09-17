/**
 * UI primitives.
 *
 * Small, typed, presentational components with no knowledge of the domain.
 * Screens compose these instead of hand-rolling `<div className="card">` and
 * inline styles, which is what made the old single file hard to change.
 */

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "t-mut",
  ok: "t-ok",
  warn: "t-warn",
  bad: "t-bad",
  info: "t-info",
};

const TONE_VAR: Record<Tone, string> = {
  neutral: "var(--muted)",
  ok: "var(--teal)",
  warn: "var(--amber)",
  bad: "var(--red)",
  info: "var(--blue)",
};

/* ---------------------------------------------------------------- layout */

export function Screen({
  eyebrow,
  title,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="pad">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h2 style={{ fontSize: 22, margin: "2px 0 0" }}>{title}</h2>
        </div>
        {actions && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function Card({
  title,
  icon: Icon,
  count,
  aside,
  footer,
  padded = true,
  children,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  count?: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="card">
      {title !== undefined && (
        <div className="card-h">
          {Icon && <Icon size={15} />}
          <strong>{title}</strong>
          {count !== undefined && <span className="eyebrow">{count}</span>}
          {aside && <div style={{ marginLeft: "auto" }}>{aside}</div>}
        </div>
      )}
      {padded ? <div className="card-b">{children}</div> : children}
      {footer && <div className="card-f">{footer}</div>}
    </div>
  );
}

export const Grid = ({
  cols = 2,
  children,
  style,
}: {
  cols?: 2 | 3 | 4 | "split";
  children: ReactNode;
  style?: React.CSSProperties;
}) => (
  <div className={`grid ${cols === "split" ? "split" : `g${cols}`}`} style={style}>
    {children}
  </div>
);

export const Stack = ({
  gap = 14,
  children,
}: {
  gap?: number;
  children: ReactNode;
}) => <div style={{ display: "grid", gap }}>{children}</div>;

export const Row = ({
  gap = 10,
  align = "center",
  children,
  style,
}: {
  gap?: number;
  align?: React.CSSProperties["alignItems"];
  children: ReactNode;
  style?: React.CSSProperties;
}) => (
  <div style={{ display: "flex", gap, alignItems: align, flexWrap: "wrap", ...style }}>
    {children}
  </div>
);

/* --------------------------------------------------------------- buttons */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "md" | "sm";
  icon?: LucideIcon;
  busy?: boolean;
  full?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", icon: Icon, busy, full, children, className, disabled, ...rest },
  ref,
) {
  const variantClass =
    variant === "primary" ? "p" : variant === "danger" ? "d" : variant === "ghost" ? "g" : "";

  return (
    <button
      ref={ref}
      type="button"
      className={["btn", variantClass, size === "sm" ? "sm" : "", full ? "full" : "", className]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? <Loader2 size={size === "sm" ? 13 : 15} className="spin" /> : Icon && <Icon size={size === "sm" ? 13 : 15} />}
      {children}
    </button>
  );
});

export const LinkButton = ({
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" className="link" {...rest}>
    {children}
  </button>
);

/* ---------------------------------------------------------------- inputs */

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={`f ${error ? "invalid" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required && <span style={{ color: "var(--red)" }}> *</span>}
      </label>
      {children(id)}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} />;
  },
);

export interface SelectProps<T extends string>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  placeholder?: string;
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  ...rest
}: SelectProps<T>) {
  return (
    <select value={value} onChange={(e) => onValueChange(e.target.value as T)} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  autoFocus,
  minWidth = 240,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  minWidth?: number;
}) {
  return (
    <div className="search-wrap" style={{ minWidth }}>
      <Search size={15} className="icon" />
      <input
        className="control"
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/* ------------------------------------------------------------- feedback */

export function Banner({
  tone = "info",
  icon,
  children,
}: {
  tone?: Exclude<Tone, "neutral">;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  const cls = tone === "ok" ? "b-ok" : tone === "warn" ? "b-warn" : tone === "bad" ? "b-bad" : "b-info";
  const Icon = icon ?? (tone === "ok" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle);
  return (
    <div className={`banner ${cls}`} role={tone === "bad" ? "alert" : "status"}>
      <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

export const Tag = ({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) => (
  <span className={`tag ${TONE_CLASS[tone]}`}>{children}</span>
);

export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  onClick?: () => void;
}) {
  const colour = TONE_VAR[tone];
  const body = (
    <>
      <div className="eyebrow">{label}</div>
      <div className="n" style={{ color: tone === "neutral" ? "var(--ink)" : colour }}>
        {value}
      </div>
      {sub && <div className="sub" style={{ marginTop: 2 }}>{sub}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="stat clickable"
        style={{ borderLeftColor: colour }}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }
  return (
    <div className="stat" style={{ borderLeftColor: colour }}>
      {body}
    </div>
  );
}

export const Empty = ({
  icon: Icon,
  children,
}: {
  icon?: LucideIcon;
  children: ReactNode;
}) => (
  <div className="empty">
    {Icon && <Icon size={26} />}
    <p style={{ margin: 0 }}>{children}</p>
  </div>
);

export const Spinner = ({ label = "Loading…" }: { label?: string }) => (
  <div className="empty" style={{ minHeight: "60vh", alignContent: "center" }}>
    <Loader2 size={26} className="spin" />
    <p style={{ margin: 0 }}>{label}</p>
  </div>
);

/* ---------------------------------------------------------------- modal */

export function Modal({
  title,
  icon: Icon,
  tone = "neutral",
  width = 520,
  onClose,
  footer,
  bare = false,
  children,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  width?: number;
  onClose: () => void;
  footer?: ReactNode;
  /** Skip the padded body — for receipts that bring their own layout. */
  bare?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Escape to close, and keep focus inside while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const headerBg =
    tone === "bad" ? "var(--red-l)" : tone === "warn" ? "var(--amber-l)" : undefined;

  return (
    <div className="ov" onClick={onClose} role="presentation">
      <div
        ref={panel}
        className="modal"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-h no-print" style={{ background: headerBg }}>
          {Icon && <Icon size={16} />}
          <strong>{title}</strong>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            aria-label="Close"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
          />
        </div>
        {bare ? children : <div className="card-b">{children}</div>}
        {footer && <div className="card-f no-print">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Destructive confirmation. When `confirmWord` is set the user must type it,
 * which is the guard the old delete dialog used and worth keeping.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  confirmWord,
  requireReason = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  confirmWord?: string;
  requireReason?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const typedRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(!confirmWord);
  const [reason, setReason] = useState("");

  const canConfirm = ready && (!requireReason || reason.trim().length > 0);

  return (
    <Modal
      title={title}
      icon={AlertTriangle}
      tone="bad"
      onClose={onCancel}
      footer={
        <>
          <Button
            variant="danger"
            disabled={!canConfirm}
            style={{ flex: 1 }}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" style={{ flex: 1 }} onClick={onCancel}>
            Cancel
          </Button>
        </>
      }
    >
      {body}
      {requireReason && (
        <Field label="Reason" required>
          {(id) => (
            <Input
              id={id}
              ref={reasonRef}
              value={reason}
              placeholder="Why is this being done?"
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      )}
      {confirmWord && (
        <Field label={`Type "${confirmWord}" to confirm`} required>
          {(id) => (
            <Input
              id={id}
              ref={typedRef}
              autoFocus
              placeholder={confirmWord}
              onChange={(e) => setReady(e.target.value.trim() === confirmWord)}
            />
          )}
        </Field>
      )}
    </Modal>
  );
}
