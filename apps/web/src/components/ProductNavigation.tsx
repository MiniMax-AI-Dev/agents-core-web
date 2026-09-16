export type ProductView = "agents" | "environments" | "sessions";

const productViews: Array<{ id: ProductView; label: string }> = [
  { id: "agents", label: "Agents" },
  { id: "environments", label: "Environments" },
  { id: "sessions", label: "Sessions" },
];

export function ProductNavigation({
  active,
  onSelect,
}: {
  active: ProductView | null;
  onSelect: (view: ProductView) => void;
}) {
  return (
    <nav className="product-navigation" aria-label="Agents product">
      {productViews.map((item) => (
        <button
          type="button"
          className={active === item.id ? "active" : ""}
          key={item.id}
          onClick={() => onSelect(item.id)}
          aria-current={active === item.id ? "page" : undefined}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
