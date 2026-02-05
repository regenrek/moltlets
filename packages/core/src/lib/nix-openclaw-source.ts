import fs from "node:fs";
import path from "node:path";

export type NixOpenclawSourceInfo = {
  rev: string;
  hash?: string;
  pnpmDepsHash?: string;
};

export type NixOpenclawSourceFetchResult =
  | { ok: true; info: NixOpenclawSourceInfo; sourceUrl: string }
  | { ok: false; error: string; sourceUrl: string };

function stripComments(contents: string): string {
  const withoutBlock = contents.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlock.replace(/(^|[^\\])#.*$/gm, "$1");
}

function decodeNixString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    const body = trimmed.slice(1, -1);
    return body.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    const body = trimmed.slice(1, -1);
    return body.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function matchAttr(contents: string, name: string): string | null {
  const pattern = `\\b${name}\\s*=\\s*(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')\\s*;`;
  const regex = new RegExp(pattern, "m");
  const match = regex.exec(contents);
  if (!match) return null;
  const value = decodeNixString(match[1] || "");
  return value ? value : null;
}

export function parseNixOpenclawSource(contents: string): NixOpenclawSourceInfo | null {
  const sanitized = stripComments(contents);
  const rev = matchAttr(sanitized, "rev");
  if (!rev) return null;
  const hash = matchAttr(sanitized, "hash") || undefined;
  const pnpmDepsHash = matchAttr(sanitized, "pnpmDepsHash") || undefined;
  return { rev, hash, pnpmDepsHash };
}

function readNodeRev(lock: any, nodeKey: string): string | null {
  const rev = lock?.nodes?.[nodeKey]?.locked?.rev;
  return typeof rev === "string" && rev.trim() ? rev.trim() : null;
}

export function getNixOpenclawRevFromFlakeLock(repoRoot: string): string | null {
  if (!repoRoot || !repoRoot.trim()) return null;
  const flakeLockPath = path.join(repoRoot, "flake.lock");
  if (!fs.existsSync(flakeLockPath)) return null;

  try {
    const lock = JSON.parse(fs.readFileSync(flakeLockPath, "utf8"));
    return readNodeRev(lock, "nix-openclaw");
  } catch {
    return null;
  }
}

const SAFE_REF_RE = /^[A-Za-z0-9._/-]{1,128}$/;
const SOURCE_REPO_CANDIDATES = ["openclaw/nix-openclaw"] as const;

function buildSourceUrl(repo: string, ref: string, fileName: string): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/nix/sources/${fileName}`;
}

export async function fetchNixOpenclawSourceInfo(params: {
  ref: string;
  timeoutMs?: number;
}): Promise<NixOpenclawSourceFetchResult> {
  if (typeof params.ref !== "string") {
    return { ok: false, error: "invalid nix-openclaw ref", sourceUrl: "" };
  }

  const safeRef = params.ref.trim() || "main";
  if (!SAFE_REF_RE.test(safeRef)) {
    return { ok: false, error: "invalid nix-openclaw ref", sourceUrl: "" };
  }

  const timeoutMs = params.timeoutMs ?? 5000;
  const firstUrl = buildSourceUrl(SOURCE_REPO_CANDIDATES[0], safeRef, "openclaw-source.nix");

  if (typeof fetch !== "function") {
    return { ok: false, error: "fetch unavailable in runtime", sourceUrl: firstUrl };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const candidateFiles = ["openclaw-source.nix", "moltbot-source.nix"] as const;
    let lastUrl = firstUrl;

    for (const repo of SOURCE_REPO_CANDIDATES) {
      for (const fileName of candidateFiles) {
        lastUrl = buildSourceUrl(repo, safeRef, fileName);
        const res = await fetch(lastUrl, { signal: controller.signal });
        if (!res.ok) {
          if (res.status === 404) continue;
          return { ok: false, error: `http ${res.status}`, sourceUrl: lastUrl };
        }

        const raw = await res.text();
        const parsed = parseNixOpenclawSource(raw);
        if (!parsed) {
          return { ok: false, error: `unable to parse ${fileName}`, sourceUrl: lastUrl };
        }
        return { ok: true, info: parsed, sourceUrl: lastUrl };
      }
    }

    return { ok: false, error: "http 404", sourceUrl: lastUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, sourceUrl: firstUrl };
  } finally {
    clearTimeout(timer);
  }
}
