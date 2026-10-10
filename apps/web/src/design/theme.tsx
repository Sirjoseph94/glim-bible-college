import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Light/dark theme (docs/ui-design-handoff.md §3.1, UI-2). The theme follows the device by
 * default; a person can pin light or dark, and the choice is kept per device. The resolved
 * theme is set as `data-theme` on <html>, which switches every token in styles/tokens.css.
 */
export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "glim.theme";

/** The stored choice; `system` when there is none or storage is unavailable (private mode). */
export function readThemePreference(
  storage: Pick<Storage, "getItem"> | undefined,
): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** Stores the choice; `system` clears it. Storage failures are ignored (the choice lasts the visit). */
export function writeThemePreference(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  preference: ThemePreference,
): void {
  try {
    if (preference === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private browsing or full storage: keep the in-memory choice.
  }
}

export function resolveTheme(preference: ThemePreference, deviceIsDark: boolean): Theme {
  if (preference === "system") return deviceIsDark ? "dark" : "light";
  return preference;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  preference: ThemePreference;
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference(safeLocalStorage()),
  );
  const [deviceIsDark, setDeviceIsDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setDeviceIsDark(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  const theme = resolveTheme(preference, deviceIsDark);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      theme,
      setPreference: (next) => {
        writeThemePreference(safeLocalStorage(), next);
        setPreferenceState(next);
      },
    }),
    [preference, theme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
