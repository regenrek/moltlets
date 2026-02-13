import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandPath } from "../storage/path-expand.js";

function uniqStable(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const v = String(value || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function looksLikePath(value: string): boolean {
  return value.includes("/") || value.includes("\\") || value.startsWith("~") || value.startsWith("$HOME") || value.startsWith("${HOME}");
}

function splitPathValue(value: string | undefined): string[] {
  const raw = String(value || "");
  if (!raw.trim()) return [];
  return raw.split(path.delimiter).map((token) => token.trim()).filter(Boolean);
}

export function prependPathDirs(pathValue: string | undefined, dirs: string[]): string {
  const existing = splitPathValue(pathValue);
  const existingSet = new Set(existing);
  const toAdd = dirs.map((d) => d.trim()).filter((d) => Boolean(d && !existingSet.has(d)));
  return [...toAdd, ...existing].join(path.delimiter);
}

export function getNixBinDirCandidates(env?: NodeJS.ProcessEnv): string[] {
  const home =
    String(env?.HOME || "").trim() ||
    String(process.env.HOME || "").trim() ||
    (() => {
      try {
        return os.homedir();
      } catch {
        return "";
      }
    })();

  return uniqStable([
    "/nix/var/nix/profiles/default/bin",
    home ? path.join(home, ".nix-profile", "bin") : "",
    home ? path.join(home, ".local", "state", "nix", "profiles", "profile", "bin") : "",
    "/run/current-system/sw/bin",
  ]);
}

export function getNixBinDirs(env?: NodeJS.ProcessEnv): string[] {
  const dirs = getNixBinDirCandidates(env);
  const out: string[] = [];
  for (const dir of dirs) {
    const nixPath = path.join(dir, "nix");
    if (isExecutableFile(nixPath)) out.push(dir);
  }
  return out;
}

function findOnPath(cmd: string, env?: NodeJS.ProcessEnv): string | null {
  const dirs = splitPathValue(env?.PATH ?? process.env.PATH);
  for (const dir of dirs) {
    const candidate = path.join(dir, cmd);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

export function resolveNixBin(params?: { env?: NodeJS.ProcessEnv; nixBin?: string }): string | null {
  const env = params?.env;
  const raw = String(params?.nixBin || env?.NIX_BIN || process.env.NIX_BIN || "nix").trim() || "nix";

  if (looksLikePath(raw) || path.isAbsolute(raw)) {
    const expanded = expandPath(raw);
    return isExecutableFile(expanded) ? expanded : null;
  }

  const cmd = raw;
  const fromPath = findOnPath(cmd, env);
  if (fromPath) return fromPath;

  for (const dir of getNixBinDirs(env)) {
    const candidate = path.join(dir, cmd);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

