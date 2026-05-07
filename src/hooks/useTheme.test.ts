import { describe, expect, it } from "vite-plus/test";
import {
  createThemeApplication,
  normalizeCachedThemePreference,
  resolveThemeMode,
} from "./useTheme";

describe("theme preference helpers", () => {
  it("stores system as the preference while applying the resolved system theme", () => {
    expect(createThemeApplication("system", "dark")).toEqual({
      storedPreference: "system",
      resolvedTheme: "dark",
    });
  });

  it("does not apply a fallback theme before settings are loaded", () => {
    expect(createThemeApplication(null, "dark")).toBeNull();
  });

  it("resolves explicit themes without consulting the system theme", () => {
    expect(resolveThemeMode("light", "dark")).toBe("light");
    expect(resolveThemeMode("dark", "light")).toBe("dark");
  });

  it("accepts cached system preference instead of dropping it", () => {
    expect(normalizeCachedThemePreference("system")).toBe("system");
  });

  it("rejects invalid cached theme preferences", () => {
    expect(normalizeCachedThemePreference("sepia")).toBeNull();
  });
});
