import { useEffect } from "react";
import type { ThemeMode } from "@moor/types";

const STORAGE_KEY = "moor-theme";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setResolvedTheme(resolved: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", resolved);
}

export function normalizeCachedThemePreference(value: string | null): ThemeMode | null {
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

export function resolveThemeMode(
  theme: ThemeMode,
  systemTheme: "light" | "dark",
): "light" | "dark" {
  return theme === "system" ? systemTheme : theme;
}

export function createThemeApplication(
  theme: ThemeMode | null,
  systemTheme: "light" | "dark",
): { storedPreference: ThemeMode; resolvedTheme: "light" | "dark" } | null {
  if (theme === null) {
    return null;
  }
  return {
    storedPreference: theme,
    resolvedTheme: resolveThemeMode(theme, systemTheme),
  };
}

function applyThemePreference(theme: ThemeMode | null) {
  const application = createThemeApplication(theme, getSystemTheme());
  if (!application) {
    return;
  }
  localStorage.setItem(STORAGE_KEY, application.storedPreference);
  setResolvedTheme(application.resolvedTheme);
}

export function applyCachedTheme() {
  const cached = normalizeCachedThemePreference(localStorage.getItem(STORAGE_KEY));
  if (cached) {
    setResolvedTheme(resolveThemeMode(cached, getSystemTheme()));
  }
}

export function useTheme(theme: ThemeMode | null) {
  useEffect(() => {
    applyThemePreference(theme);

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        setResolvedTheme(e.matches ? "dark" : "light");
      };
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);
}
