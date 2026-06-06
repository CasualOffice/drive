import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";

function resolveTheme(t: Theme): "light" | "dark" {
  if (t === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return t;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme | null) ?? "system",
  );

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", resolveTheme(theme));
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const cycle = () =>
    setTheme((t) => (t === "light" ? "dark" : t === "dark" ? "system" : "light"));

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={cycle}
      className="inline-flex items-center justify-center transition-colors"
      aria-label={`Theme: ${theme} (click to cycle)`}
      title={`Theme: ${theme}`}
      style={{
        width: "32px",
        height: "32px",
        borderRadius: "var(--radius-md)",
        color: "var(--fg-muted)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        transitionDuration: "var(--dur-fast)",
        transitionTimingFunction: "var(--ease-out)",
      }}
      onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}
