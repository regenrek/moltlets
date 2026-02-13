import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import * as p from "@clack/prompts";
import type { InstallNixMode, UiMode } from "./types.js";

export function normalizeInstallNixMode(
  modeRaw: unknown,
  skipNixRaw: unknown,
): InstallNixMode {
  if (Boolean(skipNixRaw)) return "never";
  const mode = String(modeRaw || "auto").trim().toLowerCase();
  if (mode === "auto" || mode === "always" || mode === "never") return mode;
  throw new Error("--install-nix must be one of: auto, always, never");
}

export function normalizeUiMode(modeRaw: unknown, skipUiRaw: unknown): UiMode {
  if (Boolean(skipUiRaw)) return "none";
  const mode = String(modeRaw || "dev").trim().toLowerCase();
  if (mode === "dev" || mode === "prod" || mode === "none") return mode;
  throw new Error("--ui must be one of: dev, prod, none");
}

export function parseUiPort(value: unknown): number {
  const raw = String(value ?? "").trim();
  const parsed = raw ? Number(raw) : 3000;
  if (!Number.isFinite(parsed)) throw new Error("--ui-port must be a number");
  const port = Math.trunc(parsed);
  if (port < 1 || port > 65535) throw new Error("--ui-port must be in range 1-65535");
  return port;
}

export function normalizeSiteUrl(siteUrlRaw: unknown, uiPort: number): string {
  const raw = String(siteUrlRaw || "").trim() || "http://localhost:3000";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid --site-url: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--site-url must use http or https");
  }
  const defaultProvided = raw === "http://localhost:3000";
  if (defaultProvided && uiPort !== 3000) {
    url = new URL(`http://localhost:${uiPort}`);
  }
  url.hash = "";
  url.search = "";
  url.pathname = "";
  return url.toString().replace(/\/$/, "");
}

export function requireSupportedPlatform(): string {
  const platform = os.platform();
  if (platform === "darwin" || platform === "linux") return platform;
  throw new Error(`unsupported platform: ${platform} (supported: darwin, linux)`);
}

export function requireNode22OrNewer(): string {
  const raw = process.versions.node;
  const major = Number(raw.split(".")[0] || "0");
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(`Node 22+ required (current: ${raw})`);
  }
  return raw;
}

export async function confirmOrAbort(params: {
  confirm: boolean;
  message: string;
  initialValue?: boolean;
}): Promise<void> {
  if (!params.confirm) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("interactive confirmation requires a TTY (use --no-confirm for non-interactive)");
  }
  const confirmed = await p.confirm({
    message: params.message,
    initialValue: params.initialValue ?? true,
  });
  if (p.isCancel(confirmed) || !confirmed) throw new Error("canceled");
}

export function printHuman(jsonMode: boolean, message: string): void {
  if (jsonMode) return;
  console.log(message);
}

export function deriveConvexSiteUrl(convexUrl: string): string | null {
  const raw = String(convexUrl || "").trim();
  if (!raw) return null;
  if (raw.includes(".convex.cloud")) return raw.replace(".convex.cloud", ".convex.site");
  return null;
}

export function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  if (candidatePath === rootPath) return true;
  return candidatePath.startsWith(`${rootPath}${path.sep}`);
}

async function maybeRealpath(filePath: string): Promise<string> {
  const absolute = path.resolve(filePath);
  try {
    return await fs.realpath(absolute);
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code || "")
      : "";
    if (code === "ENOENT" || code === "ENOTDIR") {
      const parent = path.dirname(absolute);
      if (parent === absolute) return absolute;
      const parentReal = await maybeRealpath(parent);
      return path.join(parentReal, path.basename(absolute));
    }
    throw err;
  }
}

export async function resolveConvexDir(params: {
  repoRoot: string;
  convexDirArg: string;
}): Promise<string> {
  const repoRootAbs = path.resolve(params.repoRoot);
  const candidate = path.isAbsolute(params.convexDirArg)
    ? path.resolve(params.convexDirArg)
    : path.resolve(repoRootAbs, params.convexDirArg);
  const [repoRootReal, candidateReal] = await Promise.all([
    maybeRealpath(repoRootAbs),
    maybeRealpath(candidate),
  ]);
  if (!isWithinRoot(repoRootReal, candidateReal)) {
    throw new Error(`--convex-dir must resolve inside repo root (${repoRootReal})`);
  }
  return candidate;
}

export function enforceJsonUiInvariant(params: {
  jsonMode: boolean;
  uiMode: UiMode;
}): void {
  if (params.jsonMode && params.uiMode !== "none") {
    throw new Error("--json requires --ui=none");
  }
}
