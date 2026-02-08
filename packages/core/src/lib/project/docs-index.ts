import fs from "node:fs";
import path from "node:path";

type DocsMeta = {
  pages?: unknown;
};

function readMeta(filePath: string): { pages: string[] } {
  if (!fs.existsSync(filePath)) throw new Error(`missing docs meta: ${filePath}`);
  const rawText = fs.readFileSync(filePath, "utf8");
  let parsed: DocsMeta;
  try {
    parsed = JSON.parse(rawText) as DocsMeta;
  } catch (err) {
    throw new Error(`docs meta must be valid JSON: ${filePath}`, { cause: err });
  }
  if (!parsed || typeof parsed !== "object") throw new Error(`docs meta must be a JSON object: ${filePath}`);
  if (!Array.isArray(parsed.pages)) throw new Error(`docs meta must contain pages: []: ${filePath}`);
  const pages = parsed.pages.map((p) => String(p));
  return { pages };
}

function normalizeEntry(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) throw new Error("docs meta pages entry cannot be empty");
  if (trimmed.startsWith("---") && trimmed.endsWith("---")) return null;
  return trimmed;
}

function isSafeRelativePath(p: string): boolean {
  if (!p) return false;
  if (path.isAbsolute(p)) return false;
  const parts = p.split(/[\\/]+/g).filter(Boolean);
  if (parts.includes("..")) return false;
  return true;
}

function ensureUniquePages(pages: string[], label: string): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const p of pages) {
    if (seen.has(p)) dupes.push(p);
    seen.add(p);
  }
  return dupes.length > 0 ? [`${label} has duplicate page(s): ${Array.from(new Set(dupes)).join(", ")}`] : [];
}

function validateMetaTree(params: {
  docsDir: string;
  metaPath: string;
  label: string;
  errors: string[];
}) {
  const { docsDir, metaPath, label, errors } = params;
  const meta = readMeta(metaPath);
  const normalized = meta.pages.map(normalizeEntry).filter(Boolean) as string[];
  errors.push(...ensureUniquePages(normalized, label));

  for (const entry of normalized) {
    if (!isSafeRelativePath(entry)) {
      errors.push(`${label} page must be a safe relative path: ${entry}`);
      continue;
    }
    const filePath = path.join(docsDir, `${entry}.mdx`);
    const dirPath = path.join(docsDir, entry);
    if (fs.existsSync(filePath)) continue;
    if (!fs.existsSync(dirPath)) {
      errors.push(`${label} references missing page: ${entry}`);
      continue;
    }

    const indexPath = path.join(dirPath, "index.mdx");
    const childMetaPath = path.join(dirPath, "meta.json");
    if (!fs.existsSync(indexPath)) {
      errors.push(`${label} references dir without index.mdx: ${entry}`);
    }
    if (!fs.existsSync(childMetaPath)) {
      errors.push(`${label} references dir without meta.json: ${entry}`);
    } else {
      validateMetaTree({
        docsDir: dirPath,
        metaPath: childMetaPath,
        label: `${label}/${entry}`,
        errors,
      });
    }
  }
}

export function validateDocsIndexIntegrity(params: {
  repoRoot: string;
  templateRoot?: string | null;
}): { ok: boolean; errors: string[] } {
  const repoRoot = params.repoRoot;
  const repoDocsDir = path.join(repoRoot, "apps", "docs", "content", "docs");
  const repoMetaPath = path.join(repoDocsDir, "meta.json");

  const templateDocsDir = params.templateRoot
    ? path.join(params.templateRoot, "apps", "docs", "content", "docs")
    : null;
  const templateMetaPath = templateDocsDir ? path.join(templateDocsDir, "meta.json") : null;

  const errors: string[] = [];

  const hasRepoDocs = fs.existsSync(repoDocsDir);
  const hasRepoMeta = fs.existsSync(repoMetaPath);
  const hasTemplateMeta = templateMetaPath ? fs.existsSync(templateMetaPath) : false;

  if (!hasRepoDocs && !hasTemplateMeta) {
    return { ok: true, errors: [] };
  }

  if (!hasRepoDocs || !hasRepoMeta) {
    errors.push(`missing docs meta: ${repoMetaPath}`);
  } else {
    try {
      validateMetaTree({ docsDir: repoDocsDir, metaPath: repoMetaPath, label: "apps/docs/content/docs/meta.json", errors });
    } catch (e) {
      errors.push(String((e as Error)?.message || e));
    }
  }

  if (templateMetaPath && hasTemplateMeta) {
    try {
      validateMetaTree({ docsDir: templateDocsDir as string, metaPath: templateMetaPath, label: path.relative(repoRoot, templateMetaPath), errors });
    } catch (e) {
      errors.push(String((e as Error)?.message || e));
    }
  }

  return { ok: errors.length === 0, errors };
}
