/**
 * Toasts. Replaces the scattered `alert()` calls and the ad-hoc `msg` state
 * every screen used to carry.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { randomId } from "@/domain";

type ToastKind = "ok" | "error" | "warn" | "info";

interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  readonly message: string;
}

export interface ToastApi {
  ok(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastKind, typeof Info> = {
  ok: CheckCircle2,
  error: AlertTriangle,
  warn: AlertTriangle,
  info: Info,
};

const LIFETIME_MS: Record<ToastKind, number> = {
  ok: 3200,
  info: 3800,
  warn: 6000,
  error: 8000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = randomId();
      setToasts((list) => [...list.slice(-4), { id, kind, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LIFETIME_MS[kind]),
      );
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      ok: (m) => push("ok", m),
      error: (m) => push("error", m),
      warn: (m) => push("warn", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts no-print" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div key={t.id} className={`toast ${t.kind}`}>
              <Icon
                size={16}
                style={{
                  flexShrink: 0,
                  marginTop: 1,
                  color:
                    t.kind === "error"
                      ? "var(--red)"
                      : t.kind === "warn"
                        ? "var(--amber)"
                        : "var(--teal)",
                }}
              />
              <span style={{ flex: 1, fontSize: 13 }}>{t.message}</span>
              <button
                type="button"
                className="link"
                aria-label="Dismiss"
                style={{ color: "var(--muted)" }}
                onClick={() => dismiss(t.id)}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}
