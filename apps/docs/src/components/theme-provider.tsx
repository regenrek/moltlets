import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { type Theme, setTheme as setThemeServer } from "@/lib/theme";

const LS_KEY = "clawlets-theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  initial,
  children,
}: {
  initial: Theme;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initial);

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY) as Theme | null;
    if (stored && stored !== initial) {
      setThemeState(stored);
    }
  }, [initial]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");

    const applied =
      theme === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;

    root.classList.add(applied);
    localStorage.setItem(LS_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === LS_KEY && event.newValue) {
        const next = event.newValue as Theme;
        if (next !== theme) {
          setThemeState(next);
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    localStorage.setItem(LS_KEY, next);
    void setThemeServer({ data: next });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be inside ThemeProvider");
  }
  return context;
}
