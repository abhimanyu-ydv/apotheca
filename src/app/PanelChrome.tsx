/**
 * Shared chrome for the role panels.
 *
 * Each panel supplies its own identity — name, accent colour, navigation and
 * home screen — so a Doctor and a Chief Pharmacist genuinely get different
 * applications rather than one application with buttons removed.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, LogOut, Pill, type LucideIcon } from "lucide-react";

import { canView, friendlyName, type Feature } from "@/domain";
import { useHotkeys, useSystemTheme } from "@/hooks";
import { useActions, useAppState, useCurrentUser } from "@/state/store";
import { Banner, Button, Tag } from "@/ui/primitives";

export interface PanelNavItem {
  readonly key: Feature;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly hotkey?: string;
  /** Badge count. Falsy hides it. */
  readonly badge?: number;
  /** Render the badge in red rather than neutral. */
  readonly alert?: boolean;
}

export interface PanelDefinition {
  /** Shown under the wordmark, e.g. "Clinical console". */
  readonly subtitle: string;
  /** Accent for the rail and highlights. */
  readonly accent: string;
  readonly nav: readonly PanelNavItem[];
  /** Screen renderer for the active tab. */
  readonly render: (tab: Feature, go: (f: Feature) => void) => ReactNode;
  /** Optional strip under the top bar — a panel-specific status line. */
  readonly statusBar?: ReactNode;
}

export function PanelChrome({ panel }: { panel: PanelDefinition }) {
  const { prefs, pendingNavigation } = useAppState();
  const user = useCurrentUser();
  const actions = useActions();
  const systemTheme = useSystemTheme();

  const visible = useMemo(
    () => panel.nav.filter((item) => canView(user, item.key)),
    [panel.nav, user],
  );

  const [tab, setTab] = useState<Feature>(() => visible[0]?.key ?? "dashboard");
  const [menuOpen, setMenuOpen] = useState(false);

  /* theme + density */
  useEffect(() => {
    const theme = prefs.theme === "system" ? systemTheme : prefs.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = prefs.density;
  }, [prefs.theme, prefs.density, systemTheme]);

  /* the rail accent is a per-panel CSS variable, so nothing hard-codes it */
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", panel.accent);
    return () => {
      document.documentElement.style.removeProperty("--accent");
    };
  }, [panel.accent]);

  /* a screen asked us to switch (Rx → billing) */
  useEffect(() => {
    if (!pendingNavigation) return;
    if (visible.some((n) => n.key === pendingNavigation)) setTab(pendingNavigation);
    actions.navigate(null);
  }, [pendingNavigation, visible, actions]);

  /* the role changed under us, or the tab is no longer reachable */
  useEffect(() => {
    if (!visible.some((n) => n.key === tab)) setTab(visible[0]?.key ?? "dashboard");
  }, [visible, tab]);

  const hotkeys = useMemo(() => {
    const map: Record<string, () => void> = {};
    for (const item of visible) if (item.hotkey) map[item.hotkey] = () => setTab(item.key);
    return map;
  }, [visible]);
  useHotkeys(hotkeys);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const timer = setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", close);
    };
  }, [menuOpen]);

  const current = visible.find((n) => n.key === tab);

  return (
    <div className="shell">
      <nav className="rail no-print" aria-label={`${user.role} navigation`}>
        <div className="rail-brand">
          <div className="rail-mark" style={{ background: panel.accent }}>
            <Pill size={16} color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="disp" style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>
              APOTHECA
            </div>
            <div className="eyebrow" style={{ color: "var(--rail-muted)" }}>
              {panel.subtitle}
            </div>
          </div>
        </div>

        {visible.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav ${tab === item.key ? "on" : ""}`}
            aria-current={tab === item.key ? "page" : undefined}
            title={item.hotkey ? `${item.label} (${item.hotkey})` : item.label}
            onClick={() => setTab(item.key)}
          >
            <item.icon size={16} />
            {item.label}
            {!!item.badge && (
              <span className={`cnt ${item.alert ? "alert" : ""}`}>{item.badge}</span>
            )}
          </button>
        ))}

        <div className="rail-spacer" style={{ marginTop: "auto" }} />
        <div className="rail-who no-print">
          <div style={{ fontWeight: 600, fontSize: 12.5, color: "#fff" }}>
            {friendlyName(user.name)}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--rail-muted)" }}>
            {user.staffId}
          </div>
        </div>
        <button type="button" className="nav" onClick={() => void actions.logout()}>
          <LogOut size={16} /> Sign out
        </button>
      </nav>

      <div className="main">
        <header className="topbar no-print">
          <strong className="disp" style={{ fontSize: 16 }}>
            {current?.label ?? "Apotheca"}
          </strong>

          {panel.statusBar}

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                style={{
                  textAlign: "right",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
                aria-expanded={menuOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{user.name}</div>
                <div className="eyebrow" style={{ fontSize: 11 }}>
                  {user.role} · {user.staffId}
                </div>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 10px)",
                    right: 0,
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--radius)",
                    padding: 14,
                    minWidth: 280,
                    boxShadow: "var(--shadow-pop)",
                    zIndex: 100,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div>
                    <div className="eyebrow">Staff ID</div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 13,
                        background: "var(--surface-2)",
                        padding: "6px 8px",
                        borderRadius: "var(--radius-sm)",
                        marginTop: 4,
                        userSelect: "all",
                        fontWeight: 600,
                      }}
                    >
                      {user.staffId}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", display: "grid", gap: 2 }}>
                    <div>{user.email}</div>
                    {user.department && <div>{user.department}</div>}
                    <div>{user.pharmacy}</div>
                  </div>
                  {canView(user, "settings") && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setTab("settings");
                        setMenuOpen(false);
                      }}
                    >
                      Settings
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={LogOut}
                    onClick={() => void actions.logout()}
                  >
                    Sign out
                  </Button>
                </div>
              )}
            </div>
          </div>
        </header>

        {canView(user, tab) ? (
          panel.render(tab, setTab)
        ) : (
          <div className="pad">
            <Banner tone="warn" icon={AlertTriangle}>
              Your role ({user.role}) doesn't have access to that screen.
            </Banner>
          </div>
        )}
      </div>
    </div>
  );
}

/** Small helper for panels that want an alert chip in the top bar. */
export function StatusChip({
  tone,
  icon: Icon,
  children,
  onClick,
}: {
  tone: "bad" | "warn" | "ok" | "info";
  icon: LucideIcon;
  children: ReactNode;
  onClick?: () => void;
}) {
  const chip = (
    <Tag tone={tone}>
      <Icon size={12} /> {children}
    </Tag>
  );
  return onClick ? (
    <button type="button" className="link" onClick={onClick}>
      {chip}
    </button>
  ) : (
    chip
  );
}
