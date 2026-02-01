import { createFileRoute } from "@tanstack/react-router";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsPageShell, loadDocsPage } from "@/lib/docs-page";

export const Route = createFileRoute("/")({
  loader: () => loadDocsPage([]),
  component: Page,
});

function Page() {
  const data = useFumadocsLoader(Route.useLoaderData());
  return <DocsPageShell data={data} />;
}
