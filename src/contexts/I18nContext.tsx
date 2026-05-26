import { createContext, useEffect, useState, type ReactNode } from "react";
import zhTranslations from "@/locales/zh.json";

type Language = "en" | "zh" | "system";
type Translations = Record<string, Record<string, string>>;

const translations: Translations = {
  zh: zhTranslations,
};

const STORAGE_KEY = "moor-language";

function resolveLanguage(lang: Language): "en" | "zh" {
  if (lang === "system") {
    const browserLang = navigator.language.toLowerCase();
    return browserLang.startsWith("zh") ? "zh" : "en";
  }
  return lang;
}

function getCachedLanguage(): Language {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached === "en" || cached === "zh" || cached === "system") {
      return cached;
    }
  } catch {
    // localStorage not available
  }
  return "system";
}

function setCachedLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // localStorage not available
  }
}

interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, vars?: Record<string, string>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getCachedLanguage);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    setCachedLanguage(lang);
  };

  const t = (key: string, vars?: Record<string, string>): string => {
    const resolved = resolveLanguage(language);
    let text = translations[resolved]?.[key] ?? key; // fallback to key (English)

    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
      });
    }

    return text;
  };

  useEffect(() => {
    // Apply language attribute to html element for potential CSS hooks
    const resolved = resolveLanguage(language);
    document.documentElement.setAttribute("lang", resolved);
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>
  );
}
