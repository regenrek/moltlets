import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { ThemeToggle } from "@/components/ThemeToggle";

export function baseOptions(): BaseLayoutProps {
  return {
    themeSwitch: {
      enabled: true,
      mode: "light-dark-system",
      component: <ThemeToggle />,
    },
    nav: {
      title: (
        <span className="flex items-center gap-2">
          <img src="/logo.png" alt="Clawlets" className="h-6 w-6" />
          <span className="text-sm font-semibold tracking-tight">Clawlets</span>
        </span>
      ),
      url: "/",
    },
    githubUrl: "https://github.com/regenrek/clawlets",
    links: [],
  };
}
