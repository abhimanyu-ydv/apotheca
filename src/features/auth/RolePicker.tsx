import {
  Boxes,
  ClipboardList,
  HeartPulse,
  ShieldCheck,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

import { ROLE_LIST, type RoleDefinition, type RoleName } from "@/domain";

const ROLE_ICON: Record<RoleName, LucideIcon> = {
  "Chief Pharmacist": ShieldCheck,
  Pharmacist: ClipboardList,
  Doctor: Stethoscope,
  "Pharmacy Staff": Boxes,
  Nurse: HeartPulse,
};

/**
 * Role selection as cards rather than a `<select>`.
 *
 * Picking your job title matters — it decides which half of the app you get —
 * and a one-line description of each role removes the guesswork that a bare
 * dropdown leaves you with.
 */
export function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: RoleName;
  onChange: (role: RoleName) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Role" style={{ display: "grid", gap: 8 }}>
      {ROLE_LIST.map((role) => (
        <RoleCard
          key={role.name}
          role={role}
          selected={role.name === value}
          disabled={disabled}
          onSelect={() => onChange(role.name)}
        />
      ))}
    </div>
  );
}

function RoleCard({
  role,
  selected,
  disabled,
  onSelect,
}: {
  role: RoleDefinition;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const Icon = ROLE_ICON[role.name];

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`role-card ${selected ? "on" : ""}`}
      style={{ borderLeftColor: selected ? role.colour : "transparent" }}
    >
      <span className="role-icon" style={{ background: selected ? role.colour : "var(--line-2)" }}>
        <Icon size={15} color={selected ? "#fff" : "var(--muted)"} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="role-name">{role.label}</span>
        <span className="role-blurb">{role.blurb}</span>
      </span>
      <span className="role-count mono">{role.view.size}</span>
    </button>
  );
}
