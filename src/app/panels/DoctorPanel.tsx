import { useMemo } from "react";
import { Boxes, LayoutGrid, Printer, Stethoscope, UserRound } from "lucide-react";

import { pendingQueue, type Feature } from "@/domain";
import { useAppState, useCurrentUser } from "@/state/store";
import { PanelChrome, type PanelDefinition } from "../PanelChrome";

import { DoctorHome } from "@/features/dashboard/DoctorHome";
import { PrescriptionsScreen } from "@/features/prescriptions/PrescriptionsScreen";
import { InventoryScreen } from "@/features/inventory/InventoryScreen";
import { PatientsScreen } from "@/features/patients/PatientsScreen";
import { BillsScreen } from "@/features/bills/BillsScreen";
import { SettingsScreen } from "@/features/settings/SettingsScreen";

/**
 * Clinical console.
 *
 * A doctor's day is: see a patient, write a prescription, occasionally check
 * whether the pharmacy actually has something before prescribing it. So the
 * prescription pad is the home screen, not a tab buried behind a stock
 * dashboard, and there is no billing, no goods inward and no cost price.
 */
export function DoctorPanel() {
  const { prescriptions } = useAppState();
  const user = useCurrentUser();

  const mine = useMemo(
    () => prescriptions.filter((rx) => rx.doctorId === user.id),
    [prescriptions, user.id],
  );
  const waiting = useMemo(() => pendingQueue(mine).length, [mine]);

  const panel: PanelDefinition = {
    subtitle: "Clinical console",
    accent: "#1D4E89",
    nav: [
      { key: "prescriptions", label: "Prescription pad", icon: Stethoscope, hotkey: "alt+x", badge: waiting },
      { key: "dashboard", label: "My activity", icon: LayoutGrid, hotkey: "alt+d" },
      { key: "patients", label: "Patients", icon: UserRound, hotkey: "alt+p" },
      { key: "inventory", label: "Check availability", icon: Boxes, hotkey: "alt+i" },
      { key: "bills", label: "Dispensing record", icon: Printer, hotkey: "alt+h" },
    ],
    render: (tab: Feature, go) => {
      switch (tab) {
        case "prescriptions":
          return <PrescriptionsScreen />;
        case "dashboard":
          return <DoctorHome go={go} />;
        case "patients":
          return <PatientsScreen />;
        case "inventory":
          return <InventoryScreen />;
        case "bills":
          return <BillsScreen />;
        case "settings":
          return <SettingsScreen />;
        default:
          return null;
      }
    },
  };

  return <PanelChrome panel={panel} />;
}
