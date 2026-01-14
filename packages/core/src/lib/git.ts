import { capture } from "./run.js";

export async function tryGetOriginFlake(repoRoot: string): Promise<string | null> {
  try {
    const origin = await capture("git", ["remote", "get-url", "origin"], { cwd: repoRoot });

    const ssh = origin.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (ssh) return `github:${ssh[1]}/${ssh[2]}`;

    const https = origin.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (https) return `github:${https[1]}/${https[2]}`;

    return null;
  } catch {
    return null;
  }
}

export async function resolveGitRev(repoRoot: string, rev: string): Promise<string | null> {
  const trimmed = rev.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{40}$/i.test(trimmed)) return trimmed;
  try {
    return await capture("git", ["rev-parse", "--verify", `${trimmed}^{commit}`], { cwd: repoRoot });
  } catch {
    return null;
  }
}
