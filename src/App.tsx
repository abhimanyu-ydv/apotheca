import { PanelRouter } from "./app/PanelRouter";
import { AuthScreen } from "./features/auth/AuthScreen";
import { ForcePasswordChange } from "./features/auth/ForcePasswordChange";
import { StoreProvider, useAppState, useDerived } from "./state/store";
import { Spinner } from "./ui/primitives";
import { ToastProvider } from "./ui/toast";

function Root() {
  const { status } = useAppState();
  const { user } = useDerived();

  if (status === "loading") return <Spinner label="Opening the pharmacy…" />;

  // Keyed on the signed-in user so the toast stack is torn down at sign-out.
  // On a shared counter terminal, one person's notifications must not still be
  // on screen when the next person signs in.
  return (
    <ToastProvider key={user?.id ?? "signed-out"}>
      {!user ? (
        <AuthScreen />
      ) : user.mustChangePassword ? (
        // An account issued by an administrator can't be used until its holder
        // has replaced the temporary password. Nothing else renders until then.
        <ForcePasswordChange />
      ) : (
        <PanelRouter />
      )}
    </ToastProvider>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Root />
    </StoreProvider>
  );
}
