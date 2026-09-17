import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Debounced mirror of a value.
 *
 * The medicine search used to recompute on every keystroke. Feeding the
 * debounced value into the query keeps typing responsive while the expensive
 * work runs once the user pauses.
 */
export function useDebounced<T>(value: T, delayMs = 180): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/** Run a click handler when the user clicks anywhere outside `ref`. */
export function useClickOutside<T extends HTMLElement>(
  onOutside: () => void,
  active = true,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const handler = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [onOutside, active]);

  return ref;
}

/** Async submit helper: tracks a busy flag and surfaces thrown errors. */
export function useAsyncAction<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: Args) => {
      setBusy(true);
      setError(null);
      try {
        await fn(...args);
      } catch (err) {
        if (mounted.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [fn],
  );

  return { run, busy, error, clearError: () => setError(null) };
}

/** Keyboard shortcuts, e.g. `{ "alt+b": () => go("billing") }`. */
export function useHotkeys(map: Record<string, () => void>, active = true) {
  const ref = useRef(map);
  ref.current = map;

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never steal keys while the user is typing into a field.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const combo = [
        e.ctrlKey || e.metaKey ? "mod" : "",
        e.altKey ? "alt" : "",
        e.shiftKey ? "shift" : "",
        e.key.toLowerCase(),
      ]
        .filter(Boolean)
        .join("+");

      const handlerFn = ref.current[combo];
      if (handlerFn) {
        e.preventDefault();
        handlerFn();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active]);
}

/** Track the OS colour-scheme preference, for `theme: "system"`. */
export function useSystemTheme(): "light" | "dark" {
  const [scheme, setScheme] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setScheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return scheme;
}
