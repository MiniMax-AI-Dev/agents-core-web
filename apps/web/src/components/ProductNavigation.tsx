import { Bot, LayoutDashboard, MessageSquare, Vault, type LucideIcon } from "lucide-react";

export type ProductView = "dashboard" | "agents" | "sessions" | "vaults";

const productViews: Array<{ id: ProductView; label: string; icon: LucideIcon }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "sessions", label: "Sessions", icon: MessageSquare },
  { id: "vaults", label: "Vaults", icon: Vault },
];

export function ProductNavigation({
  active,
  onSelect,
  showVaults = false,
}: {
  active: ProductView | null;
  onSelect: (view: ProductView) => void;
  showVaults?: boolean;
}) {
  return (
    <nav className="main-nav product-navigation" aria-label="Agents product">
      <p className="nav-label">Workspace</p>
      {productViews.filter((item) => item.id !== "vaults" || showVaults).map((item) => {
        const Icon = item.icon;
        return (
          <button
            type="button"
            className={active === item.id ? "active" : ""}
            key={item.id}
            onClick={() => onSelect(item.id)}
            aria-label={item.label}
            aria-current={active === item.id ? "page" : undefined}
          >
            <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
