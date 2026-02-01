import { useEffect, useState } from "react";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { cn } from "@/lib/utils";

type PageActionsProps = {
  markdownUrl: string;
  githubUrl: string;
};

export function PageActions({ markdownUrl, githubUrl }: PageActionsProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (status === "idle") return;
    const timeoutId = window.setTimeout(() => setStatus("idle"), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [status]);

  const handleCopy = async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      const res = await fetch(markdownUrl, { cache: "force-cache" });
      if (!res.ok) throw new Error(`Failed to fetch markdown: ${res.status}`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("error");
    } finally {
      setIsLoading(false);
    }
  };

  const copyLabel =
    status === "copied" ? "Copied" : status === "error" ? "Copy failed" : "Copy Markdown";

  return (
    <div className="not-prose flex flex-row flex-wrap items-center gap-2 border-b pb-6">
      <button
        type="button"
        onClick={handleCopy}
        disabled={isLoading}
        className={cn(
          buttonVariants({
            variant: "secondary",
            size: "sm",
            className: "gap-2",
          }),
        )}
      >
        {copyLabel}
      </button>
      <a
        href={githubUrl}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(
          buttonVariants({
            variant: "secondary",
            size: "sm",
            className: "gap-2",
          }),
        )}
      >
        Open in GitHub
      </a>
    </div>
  );
}
