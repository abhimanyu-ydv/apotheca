import { useState, type KeyboardEvent } from "react";
import { ArrowBigUp, Eye, EyeOff } from "lucide-react";
import { Field, Input } from "@/ui/primitives";

/**
 * Password input with the three things people actually need:
 * show/hide, a Caps Lock warning, and — when creating a password — a strength
 * meter that explains what's missing instead of just saying "weak".
 */

export interface PasswordStrength {
  readonly score: 0 | 1 | 2 | 3 | 4;
  readonly label: string;
  readonly tone: "bad" | "warn" | "ok";
  readonly missing: readonly string[];
}

export function scorePassword(pw: string): PasswordStrength {
  const missing: string[] = [];
  if (pw.length < 8) missing.push("8+ characters");
  if (!/[a-z]/.test(pw)) missing.push("a lowercase letter");
  if (!/[A-Z]/.test(pw)) missing.push("an uppercase letter");
  if (!/\d/.test(pw)) missing.push("a number");
  if (!/[^A-Za-z0-9]/.test(pw)) missing.push("a symbol");

  const met = 5 - missing.length;
  const long = pw.length >= 12;

  const score = (pw.length === 0 ? 0 : Math.min(4, Math.max(1, met - 1 + (long ? 1 : 0)))) as
    | 0 | 1 | 2 | 3 | 4;

  const label =
    score === 0 ? "" : score === 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong";
  const tone = score <= 1 ? "bad" : score === 2 ? "warn" : "ok";

  return { score, label, tone, missing };
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete = "current-password",
  autoFocus,
  showStrength = false,
  error,
  hint,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  showStrength?: boolean;
  error?: string | null;
  hint?: string;
  onEnter?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const strength = showStrength ? scorePassword(value) : null;

  const track = (e: KeyboardEvent<HTMLInputElement>) => {
    // getModifierState is the only reliable way to read Caps Lock.
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
    if (e.key === "Enter" && onEnter) onEnter();
  };

  return (
    <div style={{ display: "grid", gap: 5 }}>
      <Field label={label} error={error ?? null} hint={hint} required>
        {(id) => (
          <div style={{ position: "relative" }}>
            <Input
              id={id}
              type={visible ? "text" : "password"}
              value={value}
              autoFocus={autoFocus}
              autoComplete={autoComplete}
              style={{ paddingRight: 38 }}
              onChange={(e) => onChange(e.target.value)}
              onKeyUp={track}
              onKeyDown={track}
              onBlur={() => setCapsLock(false)}
            />
            <button
              type="button"
              className="pw-toggle"
              aria-label={visible ? "Hide password" : "Show password"}
              aria-pressed={visible}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        )}
      </Field>

      {capsLock && (
        <div className="pw-caps">
          <ArrowBigUp size={13} /> Caps Lock is on
        </div>
      )}

      {strength && value.length > 0 && (
        <div style={{ display: "grid", gap: 4 }}>
          <div className="pw-meter" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => (
              <i
                key={step}
                className={step <= strength.score ? `on ${strength.tone}` : ""}
              />
            ))}
          </div>
          <div className="hint">
            <strong style={{ color: `var(--${strength.tone === "ok" ? "teal" : strength.tone === "warn" ? "amber" : "red"})` }}>
              {strength.label}
            </strong>
            {strength.missing.length > 0 && ` — add ${strength.missing.slice(0, 2).join(" and ")}`}
          </div>
        </div>
      )}
    </div>
  );
}
