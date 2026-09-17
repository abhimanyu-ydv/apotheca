import { useState } from "react";
import { AlertTriangle, KeyRound, Pill, ShieldCheck } from "lucide-react";

import { validatePassword } from "@/domain";
import { useActions, useCurrentUser } from "@/state/store";
import { Banner, Button, Field, Input, LinkButton } from "@/ui/primitives";
import { PasswordField } from "./PasswordField";

const SECURITY_QUESTIONS = [
  "Which city was your first posting in?",
  "What is your pharmacy licence number?",
  "What was your first school called?",
  "What is your mother's maiden name?",
  "What was the name of your first hospital?",
] as const;

/**
 * Shown instead of the app when `mustChangePassword` is set.
 *
 * The administrator issued this password and, realistically, read it out or
 * wrote it on a slip. It has to stop working before the holder can do anything
 * — so this screen is not skippable, and it also collects the security question
 * the account doesn't have yet.
 */
export function ForcePasswordChange() {
  const user = useCurrentUser();
  const actions = useActions();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [question, setQuestion] = useState<string>(SECURITY_QUESTIONS[0]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    const check = validatePassword(next, repeat);
    if (!check.ok) return setError(check.message);
    if (!answer.trim())
      return setError("Set a security answer — it's your route back in if you forget.");

    setBusy(true);
    const problem = await actions.changeOwnPassword(current, next);
    if (!problem) await actions.setSecurityQuestion(question, answer);
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <div className="auth">
      <aside className="auth-side">
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 30 }}>
            <div className="rail-mark" style={{ width: 34, height: 34 }}>
              <Pill size={18} color="#fff" />
            </div>
            <div>
              <div className="disp" style={{ fontSize: 17, fontWeight: 600, color: "#fff" }}>
                APOTHECA
              </div>
              <div className="eyebrow" style={{ color: "var(--rail-muted)" }}>
                Hospital pharmacy system
              </div>
            </div>
          </div>

          <h1 style={{ fontSize: 32, lineHeight: 1.1, margin: "0 0 12px", color: "#fff", maxWidth: 420 }}>
            Welcome, {user.name.split(" ").slice(-1)[0]}.
          </h1>
          <p style={{ color: "#9fbaca", maxWidth: 420, margin: 0 }}>
            Your administrator issued this account. Choose your own password
            before you start — the one you were given stops working immediately.
          </p>
        </div>

        <div style={{ position: "relative", zIndex: 2, maxWidth: 420 }}>
          <div className="strip">
            <div className="eyebrow" style={{ color: "var(--rail-muted)" }}>
              Your Staff ID
            </div>
            <div className="mono" style={{ color: "#fff", fontSize: 18, fontWeight: 600 }}>
              {user.staffId}
            </div>
          </div>
          <div className="strip">
            <div className="eyebrow" style={{ color: "var(--rail-muted)" }}>
              Your role
            </div>
            <div style={{ color: "#dce8ef" }}>
              {user.role}
              {user.department && ` · ${user.department}`}
            </div>
          </div>
        </div>
      </aside>

      <main className="auth-form">
        <div className="auth-inner">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            One-time setup
          </div>
          <h2 style={{ fontSize: 26, margin: "0 0 18px" }}>Choose your password</h2>

          {error && (
            <div style={{ marginBottom: 14 }}>
              <Banner tone="bad" icon={AlertTriangle}>
                {error}
              </Banner>
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <Banner tone="warn" icon={ShieldCheck}>
              Destroy the slip your administrator gave you once you've done this.
            </Banner>
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            <PasswordField
              label="Password you were issued"
              value={current}
              onChange={setCurrent}
              autoFocus
              autoComplete="current-password"
            />

            <PasswordField
              label="Your new password"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              showStrength
            />
            <PasswordField
              label="Repeat new password"
              value={repeat}
              onChange={setRepeat}
              autoComplete="new-password"
              error={repeat && next !== repeat ? "The two passwords don't match" : null}
            />

            <Field label="Security question" hint="Used if you ever forget your password">
              {(id) => (
                <select id={id} value={question} onChange={(e) => setQuestion(e.target.value)}>
                  {SECURITY_QUESTIONS.map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Answer" required>
              {(id) => (
                <Input id={id} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              )}
            </Field>

            <Button variant="primary" full busy={busy} icon={KeyRound} onClick={submit}>
              Set password and continue
            </Button>

            <LinkButton
              style={{ textAlign: "center" }}
              onClick={() => void actions.logout()}
            >
              Sign out instead
            </LinkButton>
          </div>
        </div>
      </main>
    </div>
  );
}
