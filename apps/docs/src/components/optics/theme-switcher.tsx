"use client";

import { useControlledState } from "@/hooks/use-controlled-state";
import { Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useState, forwardRef } from "react";
import { cn } from "@/lib/utils";

const themes = [
  {
    key: "light",
    icon: Sun,
    label: "Light theme",
  },
  {
    key: "dark",
    icon: Moon,
    label: "Dark theme",
  },
] as const;

type ThemeKey = (typeof themes)[number]["key"];

interface ThemeSwitcherProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: ThemeKey;
  onThemeChange?: (theme: ThemeKey) => void;
  defaultValue?: ThemeKey;
}

export const ThemeSwitcher = forwardRef<HTMLDivElement, ThemeSwitcherProps>(
  (
    {
      value = undefined,
      onThemeChange = undefined,
      defaultValue = "light",
      className = "",
      ...props
    },
    ref,
  ) => {
    const [theme, setTheme] = useControlledState({
      defaultValue: defaultValue,
      value: value,
      onChange: onThemeChange,
    });
    const [mounted, setMounted] = useState(false);

    const handleThemeClick = useCallback(
      (themeKey: ThemeKey) => {
        setTheme(themeKey);
      },
      [setTheme],
    );

    // Prevent hydration mismatch
    useEffect(() => {
      setMounted(true);
    }, []);

    if (!mounted) {
      return null;
    }

    return (
      <div
        ref={ref}
        className={cn(
          "relative isolate flex h-8 rounded-full squircle-none bg-background p-1 ring-1 ring-border",
          className,
        )}
        {...props}
      >
        {themes.map(({ key, icon: Icon, label }) => {
          const isActive = theme === key;

          return (
            <button
              key={key}
              aria-label={label}
              className="relative h-6 w-6 rounded-full squircle-none"
              onClick={() => handleThemeClick(key)}
              type="button"
            >
              {isActive && (
                <motion.div
                  className="absolute inset-0 rounded-full squircle-none bg-secondary"
                  layoutId="activeTheme"
                  transition={{ type: "spring", duration: 0.5 }}
                />
              )}
              <Icon
                className={cn(
                  "relative z-10 m-auto h-4 w-4",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              />
            </button>
          );
        })}
      </div>
    );
  },
);

ThemeSwitcher.displayName = "ThemeSwitcher";
