import { createFileRoute } from "@tanstack/react-router";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsPageShell, loadDocsPage } from "@/lib/docs-page";

export const Route = createFileRoute("/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/").filter(Boolean) ?? [];
    return loadDocsPage(slugs);
  },
});

function Page() {
  const data = useFumadocsLoader(Route.useLoaderData());
  return <DocsPageShell data={data} />;
}
