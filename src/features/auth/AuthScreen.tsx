import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  KeyRound,
  LogIn,
  Pill,
  ShieldCheck,
} from "lucide-react";

import { findByHandle, roleColour, validatePassword, type User } from "@/domain";
import { platform } from "@/platform";
import { useActions, useAppState } from "@/state/store";
import { Banner, Button, Field, Grid, Input, LinkButton, Select } from "@/ui/primitives";
import { PasswordField } from "./PasswordField";

const SECURITY_QUESTIONS = [
  "Which city was your first posting in?",
  "What is your pharmacy licence number?",
  "What was your first school called?",
  "What is your mother's maiden name?",
  "What was the name of your first hospital?",
] as const;

type Mode = "login" | "recover";

const REMEMBER_KEY = "apotheca:last-handle";

const PITCH = [
  {
    title: "Accounts are issued, not created",
    body: "Only the Chief Pharmacist can open an account. Every member of staff gets a Staff ID and a one-time password from them.",
  },
  {
    title: "Each role gets its own console",
    body: "A doctor sees a prescription pad. The counter sees a dispensing queue. The administrator sees the whole building.",
  },
  {
    title: "Nothing happens without a name on it",
    body: "Every sign-in, receipt, adjustment, write-off and return is recorded against the person who did it.",
  },
];

export function AuthScreen() {
  const { users } = useAppState();

  // The very first run is the one and only self-service account creation.
  if (users.length === 0) return <BootstrapScreen />;
  return <SignInScreen />;
}

/* ====================================================== first-run setup */

function BootstrapScreen() {
  const actions = useActions();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pharmacy, setPharmacy] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [question, setQuestion] = useState<string>(SECURITY_QUESTIONS[0]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!name.trim()) return setError("Enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim()))
      return setError("That email address doesn't look right.");
    if (!pharmacy.trim()) return setError("Enter the hospital or pharmacy name.");

    const check = validatePassword(password, password2);
    if (!check.ok) return setError(check.message);
    if (!answer.trim())
      return setError("Add a security answer — it's the only way back into this account.");

    setBusy(true);
    const problem = await actions.bootstrap({
      name,
      email,
      phone,
      pharmacy,
      password,
      securityQuestion: question,
      securityAnswer: answer,
    });
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <Shell
      eyebrow="First run"
      heading="Set up the pharmacy"
      intro="This is the only account that can be created without an invitation."
    >
      {error && (
        <div style={{ marginBottom: 14 }}>
          <Banner tone="bad" icon={AlertTriangle}>
            {error}
          </Banner>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <Banner tone="info" icon={ShieldCheck}>
          You become the <strong>Chief Pharmacist</strong>. From then on, every
          other account — pharmacists, doctors, counter staff, nurses — is issued
          by you from the admin console. There is no public sign-up.
        </Banner>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Field label="Your full name" required>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={name}
              placeholder="Dr. A. Sharma"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>

        <Field label="Hospital / pharmacy name" hint="Appears on every invoice" required>
          {(id) => (
            <Input
              id={id}
              value={pharmacy}
              placeholder="City Hospital Pharmacy"
              onChange={(e) => setPharmacy(e.target.value)}
            />
          )}
        </Field>

        <Grid cols={2}>
          <Field label="Email" required>
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="username"
                value={email}
                placeholder="name@hospital.in"
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Phone">
            {(id) => (
              <Input
                id={id}
                type="tel"
                value={phone}
                placeholder="+91 98xxx xxxxx"
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
        </Grid>

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
        />
        <PasswordField
          label="Repeat password"
          value={password2}
          onChange={setPassword2}
          autoComplete="new-password"
          error={password2 && password !== password2 ? "The two passwords don't match" : null}
        />

        <Field label="Security question" hint="Your only route back in if you forget">
          {(id) => (
            <Select
              id={id}
              value={question}
              onValueChange={setQuestion}
              options={SECURITY_QUESTIONS.map((q) => ({ value: q, label: q }))}
            />
          )}
        </Field>
        <Field label="Answer" required>
          {(id) => (
            <Input id={id} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          )}
        </Field>

        <Button variant="primary" full busy={busy} icon={ShieldCheck} onClick={submit}>
          Create the administrator account
        </Button>
      </div>
    </Shell>
  );
}

/* ============================================================== sign in */

function SignInScreen() {
  const { users } = useAppState();
  const actions = useActions();

  const [mode, setMode] = useState<Mode>("login");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [stage, setStage] = useState<1 | 2>(1);
  const [target, setTarget] = useState<User | null>(null);
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    try {
      const last = localStorage.getItem(REMEMBER_KEY);
      if (last) setHandle(last);
    } catch {
      /* private mode — no prefill */
    }
  }, []);

  const known = useMemo(() => findByHandle(users, handle), [users, handle]);

  const say = (err: string, ok = "") => {
    setError(err);
    setNotice(ok);
  };

  const submitLogin = async () => {
    say("");
    if (!handle.trim() || !password) return say("Enter your Staff ID and password.");

    setBusy(true);
    const problem = await actions.login(handle, password);
    setBusy(false);
    if (problem) return say(problem);

    try {
      if (remember) localStorage.setItem(REMEMBER_KEY, handle.trim());
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {
      /* ignore */
    }
  };

  const findAccount = () => {
    const found = findByHandle(users, handle);
    if (!found) return say("No account uses that Staff ID or email.");
    if (!found.securityQuestion)
      return say(
        "This account has no security question set yet. Ask your administrator to reset the password.",
      );
    setTarget(found);
    setStage(2);
    say("");
  };

  const submitRecover = async () => {
    say("");
    if (!target) return;
    const check = validatePassword(password, password2);
    if (!check.ok) return say(check.message);

    setBusy(true);
    const problem = await actions.recoverPassword(target.id, answer, password);
    setBusy(false);
    if (problem) return say(problem);

    setPassword("");
    setPassword2("");
    setMode("login");
    setStage(1);
    say("", "Password updated. Sign in with the new one.");
  };

  return (
    <Shell
      eyebrow={
        mode === "recover"
          ? "Account recovery"
          : `${users.length} staff account${users.length === 1 ? "" : "s"} on this device`
      }
      heading={mode === "recover" ? "Recover your account" : "Sign in"}
    >
      {error && (
        <div style={{ marginBottom: 14 }}>
          <Banner tone="bad" icon={AlertTriangle}>
            {error}
          </Banner>
        </div>
      )}
      {notice && (
        <div style={{ marginBottom: 14 }}>
          <Banner tone="ok" icon={CheckCircle2}>
            {notice}
          </Banner>
        </div>
      )}

      {mode === "login" && (
        <div style={{ display: "grid", gap: 14 }}>
          <Field
            label="Staff ID or email"
            hint="The ID your administrator gave you, e.g. PHARM-04213"
          >
            {(id) => (
              <Input
                id={id}
                autoFocus
                autoComplete="username"
                value={handle}
                placeholder="PHARM-04213"
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submitLogin()}
              />
            )}
          </Field>

          {known && (
            <div className="who">
              <span className="who-dot" style={{ background: roleColour(known.role) }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{known.name}</strong>
                <span className="sub" style={{ display: "block" }}>
                  {known.role}
                  {known.department && ` · ${known.department}`} · {known.pharmacy}
                </span>
              </span>
              {!known.active && <span className="tag t-bad">Disabled</span>}
            </div>
          )}

          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            onEnter={submitLogin}
          />

          <label className="remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember my Staff ID on this device
          </label>

          <Button variant="primary" full busy={busy} icon={LogIn} onClick={submitLogin}>
            Sign in
          </Button>

          <LinkButton
            style={{ textAlign: "center" }}
            onClick={() => {
              setMode("recover");
              setStage(1);
              say("");
            }}
          >
            Forgot your password?
          </LinkButton>

          <div className="banner b-info" style={{ marginTop: 4 }}>
            <BadgeCheck size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              No account? Accounts are issued by the Chief Pharmacist, not signed
              up for. Ask them for your Staff ID.
            </span>
          </div>
        </div>
      )}

      {mode === "recover" && (
        <div style={{ display: "grid", gap: 14 }}>
          {stage === 1 ? (
            <>
              <Field label="Staff ID or email">
                {(id) => (
                  <Input
                    id={id}
                    autoFocus
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && findAccount()}
                  />
                )}
              </Field>
              <Button variant="primary" full icon={KeyRound} onClick={findAccount}>
                Continue
              </Button>
            </>
          ) : (
            <>
              <div className="who">
                <span className="who-dot" style={{ background: roleColour(target!.role) }} />
                <span>
                  <strong>{target?.name}</strong>
                  <span className="sub" style={{ display: "block" }}>
                    {target?.staffId} · {target?.role}
                  </span>
                </span>
              </div>

              <div className="card" style={{ padding: 12, background: "var(--surface-2)" }}>
                <div className="eyebrow">Security question</div>
                <div style={{ fontWeight: 600 }}>{target?.securityQuestion}</div>
              </div>

              <Field label="Answer" required>
                {(id) => (
                  <Input
                    id={id}
                    autoFocus
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
                )}
              </Field>

              <PasswordField
                label="New password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                showStrength
              />
              <PasswordField
                label="Repeat new password"
                value={password2}
                onChange={setPassword2}
                autoComplete="new-password"
                error={password2 && password !== password2 ? "The two passwords don't match" : null}
                onEnter={submitRecover}
              />

              <Button variant="primary" full busy={busy} onClick={submitRecover}>
                Update password
              </Button>
            </>
          )}

          <LinkButton
            style={{ textAlign: "center", width: "100%" }}
            onClick={() => {
              setMode("login");
              setStage(1);
              say("");
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArrowLeft size={13} /> Back to sign in
            </span>
          </LinkButton>
        </div>
      )}
    </Shell>
  );
}

/* ============================================================== chrome */

function Shell({
  eyebrow,
  heading,
  intro,
  children,
}: {
  eyebrow: string;
  heading: string;
  intro?: string;
  children: React.ReactNode;
}) {
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

          <h1
            style={{
              fontSize: 34,
              lineHeight: 1.1,
              margin: "0 0 12px",
              color: "#fff",
              maxWidth: 440,
            }}
          >
            One pharmacy. Five consoles. Every movement accounted for.
          </h1>
          <p style={{ color: "#9fbaca", maxWidth: 440, margin: 0 }}>
            Batch-level stock with hard expiry blocking, FEFO dispensing, GST
            invoicing and e-prescriptions from ward to counter.
          </p>
        </div>

        <div style={{ position: "relative", zIndex: 2, maxWidth: 440 }}>
          {PITCH.map((p) => (
            <div className="strip" key={p.title}>
              <div className="eyebrow" style={{ color: "var(--rail-muted)" }}>
                {p.title}
              </div>
              <div style={{ color: "#dce8ef" }}>{p.body}</div>
            </div>
          ))}
        </div>
      </aside>

      <main className="auth-form">
        <div className="auth-inner">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {eyebrow}
          </div>
          <h2 style={{ fontSize: 26, margin: intro ? "0 0 8px" : "0 0 18px" }}>{heading}</h2>
          {intro && <p className="sub" style={{ margin: "0 0 18px" }}>{intro}</p>}

          {!platform.crypto.available && (
            <div style={{ marginBottom: 14 }}>
              <Banner tone="warn">
                Passwords can't be hashed on an insecure origin. Open the app on{" "}
                <strong>http://localhost</strong> or over HTTPS.
              </Banner>
            </div>
          )}

          {children}

          <p className="sub" style={{ marginTop: 22 }}>
            Passwords are hashed with {platform.crypto.algorithm} in your browser.
            The bundled PostgreSQL backend uses Argon2id instead — see{" "}
            <code>server/README.md</code>.
          </p>
        </div>
      </main>
    </div>
  );
}
