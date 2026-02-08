import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { Suspense } from "react";
import browserCollections from "fumadocs-mdx:collections/browser";
import { PageActions } from "@/components/page-actions";
import { baseOptions } from "@/lib/layout.shared";
import { mdxComponents } from "@/lib/mdx-components";

const DOCS_GITHUB_REPO = "https://github.com/regenrek/clawlets";
const DOCS_GITHUB_BRANCH = "main";
const DOCS_GITHUB_PATH = "apps/docs/content/docs";

export const serverLoader = createServerFn({
  method: "GET",
})
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const { source } = await import("@/lib/source");
    const page = source.getPage(slugs);
    if (!page) throw notFound();

    return {
      path: page.path,
      pageUrl: page.url,
      pagePath: page.path,
      pageTree: await source.serializePageTree(source.getPageTree()),
    };
  });

export const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: MDX },
    props: {
      className?: string;
      pageUrl: string;
      pagePath: string;
    },
  ) {
    const { className, pageUrl, pagePath } = props;
    const markdownUrl = `/api/mdx?path=${encodeURIComponent(pageUrl)}`;
    const githubUrl = `${DOCS_GITHUB_REPO}/blob/${DOCS_GITHUB_BRANCH}/${DOCS_GITHUB_PATH}/${pagePath}`;

    return (
      <DocsPage toc={toc} className={className}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <PageActions markdownUrl={markdownUrl} githubUrl={githubUrl} />
        <DocsBody>
          <MDX components={mdxComponents} />
        </DocsBody>
      </DocsPage>
    );
  },
});

export async function loadDocsPage(slugs: string[]) {
  const data = await serverLoader({ data: slugs });
  await clientLoader.preload(data.path);
  return data;
}

type DocsPageData = {
  path: string;
  pageUrl: string;
  pagePath: string;
  tree?: React.ComponentProps<typeof DocsLayout>["tree"];
  pageTree?: React.ComponentProps<typeof DocsLayout>["tree"];
};

export function DocsPageShell({ data }: { data: ReturnType<typeof useFumadocsLoader> }) {
  const docsData = data as unknown as DocsPageData;
  const tree = docsData.tree ?? docsData.pageTree;
  if (!tree) return null;
  return (
    <DocsLayout {...baseOptions()} tree={tree}>
      <Suspense>
        {clientLoader.useContent(docsData.path, {
          className: "",
          pageUrl: docsData.pageUrl,
          pagePath: docsData.pagePath,
        })}
      </Suspense>
    </DocsLayout>
  );
}
