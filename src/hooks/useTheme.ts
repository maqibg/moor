import { useEffect } from "react";
import type { ThemeMode } from "@moor/types";

const STORAGE_KEY = "moor-theme";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", resolved);
  localStorage.setItem(STORAGE_KEY, resolved);
}

export function applyCachedTheme() {
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached === "dark" || cached === "light") {
    document.documentElement.setAttribute("data-theme", cached);
  }
}

export function useTheme(theme: ThemeMode) {
  useEffect(() => {
    const resolved = theme === "system" ? getSystemTheme() : theme;
    applyTheme(resolved);

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? "dark" : "light");
      };
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);
}
