"use client";

import { useEffect, useState } from "react";
import { ThemeSwitcher } from "@/components/optics/theme-switcher";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [prefersDark, setPrefersDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(media.matches);
    const handler = (event: MediaQueryListEvent) =>
      setPrefersDark(event.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  if (!mounted) {
    return null;
  }

  // UI is light/dark only (no system), but we can start from system-resolved value.
  const resolvedTheme =
    theme === "system" ? (prefersDark ? "dark" : "light") : theme;

  return (
    <ThemeSwitcher value={resolvedTheme} onChange={(next) => setTheme(next)} />
  );
}
