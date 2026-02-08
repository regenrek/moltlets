/* eslint-disable no-restricted-syntax -- code-split heavy Mermaid dependency */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/theme-provider";

interface MermaidProps {
  chart: string;
}

export function Mermaid({ chart }: MermaidProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();

  const safeId = useMemo(() => {
    // React's useId can include characters like ":" which can be awkward for some libs.
    const stripped = id.replace(/[^a-zA-Z0-9_-]/g, "");
    return `mermaid-${stripped || "diagram"}`;
  }, [id]);

  const resolvedTheme = useMemo(() => {
    if (theme !== "system") {
      return theme;
    }
    if (typeof window === "undefined") {
      return "light";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }, [theme]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;
    let cancelled = false;
    const renderMermaid = async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        if (cancelled || !containerRef.current) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          fontFamily: "inherit",
          themeCSS: "margin: 1.5rem auto 0;",
          theme: resolvedTheme === "dark" ? "dark" : "default",
        });
        const chartText = chart.replaceAll("\\n", "\n").replaceAll("\r\n", "\n").trim();
        const result = await mermaid.render(safeId, chartText);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = result.svg;
        result.bindFunctions?.(containerRef.current);
      } catch {
        // Fail closed: no diagram, avoid throwing in docs render.
      }
    };
    void renderMermaid();

    return () => {
      cancelled = true;
    };
  }, [chart, mounted, resolvedTheme, safeId]);

  if (!mounted) return null;
  return <div ref={containerRef} data-mermaid />;
}
