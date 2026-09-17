import { useMemo } from "react";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  Database,
  LayoutGrid,
  Plus,
  Printer,
  Receipt,
  ScrollText,
  Settings,
  Stethoscope,
  UserRound,
  Users,
} from "lucide-react";

import { bucketByExpiry, pendingQueue, type Feature } from "@/domain";
import { useAppState, useDerived } from "@/state/store";
import { PanelChrome, StatusChip, type PanelDefinition } from "../PanelChrome";

import { AdminHome } from "@/features/dashboard/AdminHome";
import { StaffScreen } from "@/features/admin/StaffScreen";
import { AuditScreen } from "@/features/audit/AuditScreen";
import { DataScreen } from "@/features/admin/DataScreen";
import { PrescriptionsScreen } from "@/features/prescriptions/PrescriptionsScreen";
import { AddStockScreen } from "@/features/stock/AddStockScreen";
import { InventoryScreen } from "@/features/inventory/InventoryScreen";
import { BillingScreen } from "@/features/billing/BillingScreen";
import { BillsScreen } from "@/features/bills/BillsScreen";
import { ExpiryScreen } from "@/features/expiry/ExpiryScreen";
import { PatientsScreen } from "@/features/patients/PatientsScreen";
import { SettingsScreen } from "@/features/settings/SettingsScreen";

/**
 * Administrator console — Chief Pharmacist only.
 *
 * Deliberately opens on **Staff & access**, not on stock. The administrator's
 * distinct job is running the building: who has an account, what they may do,
 * what they did, and whether the data is backed up. The operational screens are
 * all still here, grouped below, because the Chief Pharmacist works the counter
 * too — but they are not what this console is *for*.
 */
export function AdminPanel() {
  const { bills, prescriptions, users } = useAppState();
  const { stockIndex } = useDerived();

  const expired = useMemo(() => bucketByExpiry(stockIndex.all).expired.length, [stockIndex]);
  const waiting = useMemo(() => pendingQueue(prescriptions).length, [prescriptions]);
  const pendingSetup = useMemo(
    () => users.filter((u) => u.mustChangePassword && u.active).length,
    [users],
  );

  const panel: PanelDefinition = {
    subtitle: "Administrator console",
    accent: "#0A5C51",
    statusBar: (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {pendingSetup > 0 && (
          <StatusChip tone="info" icon={Users}>
            {pendingSetup} awaiting first sign-in
          </StatusChip>
        )}
        {expired > 0 && (
          <StatusChip tone="bad" icon={AlertTriangle}>
            {expired} expired
          </StatusChip>
        )}
      </div>
    ),
    nav: [
      { key: "staff", label: "Staff & access", icon: Users, badge: users.length },
      { key: "dashboard", label: "Overview", icon: LayoutGrid, hotkey: "alt+d" },
      { key: "audit", label: "Audit trail", icon: ScrollText },
      { key: "settings", label: "Data & backup", icon: Database },

      { key: "prescriptions", label: "Prescriptions", icon: Stethoscope, hotkey: "alt+x", badge: waiting, alert: true },
      { key: "billing", label: "Dispense", icon: Receipt, hotkey: "alt+b" },
      { key: "inventory", label: "Stock", icon: Boxes, hotkey: "alt+i", badge: stockIndex.all.length },
      { key: "addStock", label: "Receive stock", icon: Plus, hotkey: "alt+r" },
      { key: "expiry", label: "Expiry desk", icon: CalendarClock, hotkey: "alt+e", badge: expired, alert: true },
      { key: "bills", label: "Bills", icon: Printer, hotkey: "alt+h", badge: bills.length },
      { key: "patients", label: "Patients", icon: UserRound, hotkey: "alt+p" },
    ],
    render: (tab: Feature, go) => {
      switch (tab) {
        case "staff":
          return <StaffScreen />;
        case "dashboard":
          return <AdminHome go={go} />;
        case "audit":
          return <AuditScreen />;
        // The admin's "Settings" tab is the data console; personal preferences
        // live inside it rather than competing for a nav slot.
        case "settings":
          return <DataScreen />;
        case "prescriptions":
          return <PrescriptionsScreen />;
        case "billing":
          return <BillingScreen />;
        case "inventory":
          return <InventoryScreen />;
        case "addStock":
          return <AddStockScreen />;
        case "expiry":
          return <ExpiryScreen />;
        case "bills":
          return <BillsScreen />;
        case "patients":
          return <PatientsScreen />;
        default:
          return null;
      }
    },
  };

  return <PanelChrome panel={panel} />;
}

/** Re-exported so DataScreen can offer the personal preferences panel inline. */
export { SettingsScreen, Settings };
