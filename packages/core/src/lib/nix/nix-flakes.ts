import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getNixBinDirs, prependPathDirs } from "./nix-bin.js";

function hasNeededExperimentalFeatures(existing: string): boolean {
  const normalized = existing.replace(/\s+/g, " ").toLowerCase();
  if (!normalized.includes("experimental-features")) return false;
  return normalized.includes("nix-command") && normalized.includes("flakes");
}

function isWritableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isWritablePathOrParent(target: string): boolean {
  const normalized = target.trim();
  if (!normalized) return false;
  try {
    fs.accessSync(normalized, fs.constants.W_OK);
    return true;
  } catch {
    try {
      fs.accessSync(path.dirname(normalized), fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export function withFlakesEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = { ...process.env, ...env };
  const nixBinDirs = getNixBinDirs(base);
  const withNixPath =
    nixBinDirs.length === 0
      ? base
      : (() => {
          const nextPath = prependPathDirs(base.PATH, nixBinDirs);
          return nextPath === base.PATH ? base : { ...base, PATH: nextPath };
        })();
  const homeDir = String(withNixPath.HOME || "").trim();
  const needsPrivateXdgHome = Boolean(homeDir) && !isWritableDir(homeDir);

  const xdgRoot = path.join(os.tmpdir(), "clawlets-xdg");
  const withXdg = needsPrivateXdgHome
    ? {
        ...withNixPath,
        XDG_CACHE_HOME: isWritablePathOrParent(String(withNixPath.XDG_CACHE_HOME || "")) ? withNixPath.XDG_CACHE_HOME : path.join(xdgRoot, "cache"),
        XDG_CONFIG_HOME: isWritablePathOrParent(String(withNixPath.XDG_CONFIG_HOME || "")) ? withNixPath.XDG_CONFIG_HOME : path.join(xdgRoot, "config"),
        XDG_DATA_HOME: isWritablePathOrParent(String(withNixPath.XDG_DATA_HOME || "")) ? withNixPath.XDG_DATA_HOME : path.join(xdgRoot, "data"),
        XDG_STATE_HOME: isWritablePathOrParent(String(withNixPath.XDG_STATE_HOME || "")) ? withNixPath.XDG_STATE_HOME : path.join(xdgRoot, "state"),
      }
    : withNixPath;

  const neededFlakes = "experimental-features = nix-command flakes";
  const neededXdg = "use-xdg-base-directories = true";
  const existing = String(withXdg.NIX_CONFIG || "").trim();

  if (!existing) {
    return {
      ...withXdg,
      NIX_CONFIG: needsPrivateXdgHome ? `${neededFlakes}\n${neededXdg}` : neededFlakes,
    };
}

  const additions: string[] = [];
  if (!hasNeededExperimentalFeatures(existing)) additions.push(neededFlakes);
  if (needsPrivateXdgHome) additions.push(neededXdg);
  if (additions.length === 0) return withXdg;

  return { ...withXdg, NIX_CONFIG: `${existing}\n${additions.join("\n")}` };
}
