import { useCurrentUser } from "@/state/store";
import { AdminPanel } from "./panels/AdminPanel";
import { CounterPanel } from "./panels/CounterPanel";
import { DoctorPanel } from "./panels/DoctorPanel";
import { WardPanel } from "./panels/WardPanel";

/**
 * Which application you get.
 *
 * This is the whole point of the role system: a Doctor and a Chief Pharmacist
 * do not open the same app with different buttons greyed out — they open
 * different consoles, with different home screens, navigation, accent colour
 * and vocabulary.
 */
export function PanelRouter() {
  const user = useCurrentUser();

  switch (user.role) {
    case "Chief Pharmacist":
      return <AdminPanel />;
    case "Doctor":
      return <DoctorPanel />;
    case "Nurse":
      return <WardPanel />;
    case "Pharmacist":
    case "Pharmacy Staff":
      return <CounterPanel />;
    default:
      return <CounterPanel />;
  }
}
