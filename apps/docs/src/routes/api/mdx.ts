import { createFileRoute } from "@tanstack/react-router";
import { source } from "@/lib/source";

function pathToSlugs(path: string) {
  if (!path || path === "/") return [];
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.split("/").filter(Boolean);
}

export const Route = createFileRoute("/api/mdx")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const rawPath = url.searchParams.get("path") ?? "/";
        const slugs = pathToSlugs(rawPath);
        const page = source.getPage(slugs);
        if (!page) {
          return new Response("Not Found", { status: 404 });
        }

        let content: string;
        try {
          content = await page.data.getText("processed");
        } catch {
          content = await page.data.getText("raw");
        }
        return new Response(content, {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
          },
        });
      },
    },
  },
});
