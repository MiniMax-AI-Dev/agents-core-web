import { Moon, Sun } from "lucide-react";

import { useTheme, type ResolvedTheme } from "../lib/theme";

export function ThemeMenu() {
  const { resolvedTheme, setPreference } = useTheme();
  const segments: Array<{ value: ResolvedTheme; Icon: typeof Sun; label: string }> = [
    { value: "light", Icon: Sun, label: "Light theme" },
    { value: "dark", Icon: Moon, label: "Dark theme" },
  ];

  return (
    <div className="theme-menu" role="group" aria-label="Theme">
      {segments.map(({ value, Icon, label }) => {
        const pressed = resolvedTheme === value;
        return (
          <button
            className={pressed ? "active" : ""}
            key={value}
            type="button"
            aria-pressed={pressed}
            aria-label={label}
            title={label}
            onClick={() => setPreference(value)}
          >
            <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
