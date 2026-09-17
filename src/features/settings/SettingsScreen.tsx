import { useState } from "react";
import { Contrast, KeyRound, Monitor, Moon, Rows3, Sun, UserCog } from "lucide-react";

import { validatePassword } from "@/domain";
import { platform } from "@/platform";
import { useActions, useCurrentUser, usePreferences } from "@/state/store";
import {
  Banner,
  Button,
  Card,
  Field,
  Grid,
  Screen,
  Select,
  Stat,
} from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { PasswordField } from "../auth/PasswordField";

/** Appearance controls — reused inside the admin's Data console. */
export function AppearanceCard() {
  const prefs = usePreferences();
  const actions = useActions();

  return (
    <Card title="Appearance" icon={Contrast}>
      <Field label="Theme" hint="Dark mode is easier on the eyes for a night counter">
        {(id) => (
          <Select
            id={id}
            value={prefs.theme}
            onValueChange={(v) => actions.setPrefs({ theme: v as typeof prefs.theme })}
            options={[
              { value: "system", label: "Match the operating system" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        )}
      </Field>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          icon={Monitor}
          variant={prefs.theme === "system" ? "primary" : "default"}
          onClick={() => actions.setPrefs({ theme: "system" })}
        >
          System
        </Button>
        <Button
          icon={Sun}
          variant={prefs.theme === "light" ? "primary" : "default"}
          onClick={() => actions.setPrefs({ theme: "light" })}
        >
          Light
        </Button>
        <Button
          icon={Moon}
          variant={prefs.theme === "dark" ? "primary" : "default"}
          onClick={() => actions.setPrefs({ theme: "dark" })}
        >
          Dark
        </Button>
        <Button
          icon={Rows3}
          onClick={() =>
            actions.setPrefs({
              density: prefs.density === "compact" ? "comfortable" : "compact",
            })
          }
        >
          {prefs.density === "compact" ? "Comfortable rows" : "Compact rows"}
        </Button>
      </div>
    </Card>
  );
}

/** Personal settings, for every role that isn't the administrator. */
export function SettingsScreen() {
  const user = useCurrentUser();
  const actions = useActions();
  const toast = useToast();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const changePassword = async () => {
    setError("");
    const check = validatePassword(next, repeat);
    if (!check.ok) return setError(check.message);

    setBusy(true);
    const problem = await actions.changeOwnPassword(current, next);
    setBusy(false);
    if (problem) return setError(problem);

    setCurrent("");
    setNext("");
    setRepeat("");
    toast.ok("Password changed.");
  };

  return (
    <Screen eyebrow="Your account" title="Settings">
      <Grid cols={2}>
        <Card title="Your account" icon={UserCog}>
          <Grid cols={2}>
            <Stat label="Staff ID" value={user.staffId} />
            <Stat label="Role" value={user.role} />
          </Grid>
          <dl style={{ display: "grid", gap: 8, margin: 0 }}>
            <Detail label="Name" value={user.name} />
            <Detail label="Email" value={user.email} />
            {user.phone && <Detail label="Phone" value={user.phone} />}
            {user.department && <Detail label="Department" value={user.department} />}
            <Detail label="Pharmacy" value={user.pharmacy} />
          </dl>
          <Banner tone="info">
            Your name, role and department are set by the administrator. Ask them
            if any of it is wrong.
          </Banner>
        </Card>

        <Card title="Change your password" icon={KeyRound}>
          {error && <Banner tone="bad">{error}</Banner>}

          <PasswordField
            label="Current password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
          <PasswordField
            label="New password"
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
            onEnter={changePassword}
          />
          <Button
            variant="primary"
            icon={KeyRound}
            busy={busy}
            disabled={!current || !next || next !== repeat}
            onClick={changePassword}
          >
            Change password
          </Button>
        </Card>
      </Grid>

      <AppearanceCard />

      <Card title="This installation">
        <dl style={{ display: "grid", gap: 8, margin: 0 }}>
          <Detail label="Platform" value={platform.id} />
          <Detail label="Storage" value={platform.store.name} />
          <Detail label="Password hashing" value={platform.crypto.algorithm} />
        </dl>
        <div className="sub">
          Keyboard shortcuts: <kbd>alt</kbd>+<kbd>d</kbd> home, <kbd>alt</kbd>+
          <kbd>x</kbd> prescriptions, <kbd>alt</kbd>+<kbd>i</kbd> stock,{" "}
          <kbd>alt</kbd>+<kbd>b</kbd> dispense, <kbd>alt</kbd>+<kbd>e</kbd> expiry.
        </div>
      </Card>
    </Screen>
  );
}

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
    <dt className="eyebrow" style={{ margin: 0 }}>
      {label}
    </dt>
    <dd className="mono" style={{ margin: 0, fontSize: 12, textAlign: "right" }}>
      {value}
    </dd>
  </div>
);
