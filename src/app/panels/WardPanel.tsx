import { Boxes, LayoutGrid, Printer, Stethoscope, UserRound } from "lucide-react";

import type { Feature } from "@/domain";
import { PanelChrome, type PanelDefinition } from "../PanelChrome";

import { WardHome } from "@/features/dashboard/WardHome";
import { InventoryScreen } from "@/features/inventory/InventoryScreen";
import { PrescriptionsScreen } from "@/features/prescriptions/PrescriptionsScreen";
import { PatientsScreen } from "@/features/patients/PatientsScreen";
import { BillsScreen } from "@/features/bills/BillsScreen";
import { SettingsScreen } from "@/features/settings/SettingsScreen";

/**
 * Ward console — Nurse.
 *
 * Read-only by design. A nurse needs to answer "do we have this, and did the
 * patient get it?" without being able to move stock or issue money.
 */
export function WardPanel() {
  const panel: PanelDefinition = {
    subtitle: "Ward console",
    accent: "#5F7688",
    nav: [
      { key: "inventory", label: "Check availability", icon: Boxes, hotkey: "alt+i" },
      { key: "dashboard", label: "Ward overview", icon: LayoutGrid, hotkey: "alt+d" },
      { key: "prescriptions", label: "Prescriptions", icon: Stethoscope, hotkey: "alt+x" },
      { key: "patients", label: "Patients", icon: UserRound, hotkey: "alt+p" },
      { key: "bills", label: "Dispensing record", icon: Printer, hotkey: "alt+h" },
    ],
    render: (tab: Feature, go) => {
      switch (tab) {
        case "inventory":
          return <InventoryScreen />;
        case "dashboard":
          return <WardHome go={go} />;
        case "prescriptions":
          return <PrescriptionsScreen />;
        case "patients":
          return <PatientsScreen />;
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
