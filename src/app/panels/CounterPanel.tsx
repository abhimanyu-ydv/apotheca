import { useMemo } from "react";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  LayoutGrid,
  Plus,
  Printer,
  Receipt,
  ScrollText,
  Stethoscope,
  UserRound,
} from "lucide-react";

import { bucketByExpiry, canView, pendingQueue, type Feature } from "@/domain";
import { useAppState, useCurrentUser, useDerived } from "@/state/store";
import { PanelChrome, StatusChip, type PanelDefinition } from "../PanelChrome";

import { DashboardScreen } from "@/features/dashboard/DashboardScreen";
import { PrescriptionsScreen } from "@/features/prescriptions/PrescriptionsScreen";
import { AddStockScreen } from "@/features/stock/AddStockScreen";
import { InventoryScreen } from "@/features/inventory/InventoryScreen";
import { BillingScreen } from "@/features/billing/BillingScreen";
import { BillsScreen } from "@/features/bills/BillsScreen";
import { ExpiryScreen } from "@/features/expiry/ExpiryScreen";
import { PatientsScreen } from "@/features/patients/PatientsScreen";
import { AuditScreen } from "@/features/audit/AuditScreen";
import { SettingsScreen } from "@/features/settings/SettingsScreen";

/**
 * Dispensing console — Pharmacist and Pharmacy Staff.
 *
 * The counter's day is driven by two queues: prescriptions waiting to be filled
 * and expired stock waiting to be pulled. Both are surfaced in the top bar so
 * they're visible from whatever screen you're on.
 *
 * `canView` still filters the nav, so Pharmacy Staff sees a shorter list than a
 * Pharmacist without needing a separate panel.
 */
export function CounterPanel() {
  const { bills, prescriptions } = useAppState();
  const { stockIndex } = useDerived();
  const user = useCurrentUser();

  const expired = useMemo(
    () => bucketByExpiry(stockIndex.all).expired.length,
    [stockIndex],
  );
  const waiting = useMemo(() => pendingQueue(prescriptions).length, [prescriptions]);

  const panel: PanelDefinition = {
    subtitle: user.role === "Pharmacist" ? "Dispensing console" : "Counter console",
    accent: "#0E7A6B",
    statusBar: (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {waiting > 0 && (
          <StatusChip tone="warn" icon={Stethoscope}>
            {waiting} Rx waiting
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
      { key: "billing", label: "Dispense", icon: Receipt, hotkey: "alt+b" },
      {
        key: "prescriptions",
        label: "Prescription queue",
        icon: Stethoscope,
        hotkey: "alt+x",
        badge: waiting,
        alert: true,
      },
      { key: "dashboard", label: "Dashboard", icon: LayoutGrid, hotkey: "alt+d" },
      { key: "inventory", label: "Stock", icon: Boxes, hotkey: "alt+i", badge: stockIndex.all.length },
      { key: "addStock", label: "Receive stock", icon: Plus, hotkey: "alt+r" },
      { key: "expiry", label: "Expiry desk", icon: CalendarClock, hotkey: "alt+e", badge: expired, alert: true },
      { key: "bills", label: "Bills", icon: Printer, hotkey: "alt+h", badge: bills.length },
      { key: "patients", label: "Patients", icon: UserRound, hotkey: "alt+p" },
      { key: "audit", label: "Audit", icon: ScrollText },
    ],
    render: (tab: Feature, go) => {
      switch (tab) {
        case "billing":
          return <BillingScreen />;
        case "prescriptions":
          return <PrescriptionsScreen />;
        case "dashboard":
          return <DashboardScreen go={go} />;
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
        case "audit":
          return canView(user, "audit") ? <AuditScreen /> : null;
        case "settings":
          return <SettingsScreen />;
        default:
          return null;
      }
    },
  };

  return <PanelChrome panel={panel} />;
}
