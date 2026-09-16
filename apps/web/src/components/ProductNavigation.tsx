import { Bot, MessageSquare, type LucideIcon } from "lucide-react";

export type ProductView = "agents" | "sessions";

const productViews: Array<{ id: ProductView; label: string; icon: LucideIcon }> = [
  { id: "agents", label: "Agents", icon: Bot },
  { id: "sessions", label: "Sessions", icon: MessageSquare },
];

export function ProductNavigation({
  active,
  onSelect,
}: {
  active: ProductView | null;
  onSelect: (view: ProductView) => void;
}) {
  return (
    <nav className="main-nav product-navigation" aria-label="Agents product">
      <p className="nav-label">Workspace</p>
      {productViews.map((item) => {
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
