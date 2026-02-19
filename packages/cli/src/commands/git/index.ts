import process from "node:process";
import path from "node:path";
import { defineCommand } from "citty";
import { capture, run } from "@clawlets/core/lib/runtime/run";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";

function gitEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
  };
}

type GitStatusResult = {
  branch: string | null;
  upstream: string | null;
  localHead: string | null;
  originDefaultRef: string | null;
  originHead: string | null;
  dirty: boolean;
  ahead: number | null;
  behind: number | null;
  detached: boolean;
  needsPush: boolean;
  canPush: boolean;
  pushBlockedReason?: string;
};

type GitSetupSaveResult = {
  ok: true;
  host: string;
  branch: string;
  sha: string | null;
  committed: boolean;
  pushed: boolean;
  changedPaths: string[];
};

async function readSymbolicBranch(cwd: string): Promise<string | null> {
  try {
    const value = (await capture("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd, env: gitEnv() })).trim();
    return value || null;
  } catch {
    return null;
  }
}

async function readLocalHead(cwd: string): Promise<string | null> {
  const symbolicBranch = await readSymbolicBranch(cwd);
  if (symbolicBranch) {
    return await readBranchHead(cwd, symbolicBranch);
  }
  return await readDetachedHead(cwd);
}

async function readDetachedHead(cwd: string): Promise<string | null> {
  try {
    const value = (await capture("git", ["rev-parse", "--verify", "HEAD"], { cwd, env: gitEnv() })).trim();
    return value || null;
  } catch {
    return null;
  }
}

function splitNullDelimitedList(raw: string): string[] {
  return raw
    .split("\0")
    .map((row) => row.trim())
    .filter(Boolean);
}

function isSetupOwnedPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!normalized) return false;
  if (path.posix.isAbsolute(normalized)) return false;
  if (normalized.startsWith("../") || normalized === "..") return false;
  // Setup owns fleet/* and secrets/* only.
  return normalized === "fleet" || normalized.startsWith("fleet/")
    || normalized === "secrets" || normalized.startsWith("secrets/");
}

function formatUnsafePathError(paths: string[]): string {
  const maxShown = 20;
  const shown = paths.slice(0, maxShown);
  const extra = paths.length - shown.length;
  const lines = [
    "refusing to save setup changes: repo has non-setup modifications",
    ...shown.map((p0) => `- ${p0}`),
    ...(extra > 0 ? [`- (+${extra} more)`] : []),
    "",
    "Only fleet/ and secrets/ are allowed. Commit or discard other changes, then retry.",
  ];
  return lines.join("\n");
}

async function listChangedPaths(cwd: string): Promise<string[]> {
  const [unstaged, staged, untracked] = await Promise.all([
    capture("git", ["diff", "--name-only", "-z"], { cwd, env: gitEnv() }),
    capture("git", ["diff", "--cached", "--name-only", "-z"], { cwd, env: gitEnv() }),
    capture("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd, env: gitEnv() }),
  ]);
  const all = new Set<string>();
  for (const p0 of splitNullDelimitedList(unstaged)) all.add(p0);
  for (const p0 of splitNullDelimitedList(staged)) all.add(p0);
  for (const p0 of splitNullDelimitedList(untracked)) all.add(p0);
  return Array.from(all).toSorted();
}

async function listStagedPaths(cwd: string): Promise<string[]> {
  const raw = await capture("git", ["diff", "--cached", "--name-only", "-z"], { cwd, env: gitEnv() });
  return splitNullDelimitedList(raw).toSorted();
}

function validateHostName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("missing --host");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) throw new Error("invalid --host");
  return trimmed;
}

async function readBranchHead(cwd: string, branch: string): Promise<string | null> {
  try {
    const value = (
      await capture("git", ["for-each-ref", "--format", "%(objectname)", `refs/heads/${branch}`], { cwd, env: gitEnv() })
    ).trim();
    return value || null;
  } catch {
    return null;
  }
}

async function readBranchUpstream(cwd: string, branch: string): Promise<string | null> {
  try {
    const value = (
      await capture("git", ["for-each-ref", "--format", "%(upstream:short)", `refs/heads/${branch}`], { cwd, env: gitEnv() })
    ).trim();
    return value || null;
  } catch {
    return null;
  }
}

async function readRemoteRefHead(cwd: string, shortRef: string): Promise<string | null> {
  const normalized = shortRef.trim();
  if (!normalized) return null;
  const refPath = normalized.startsWith("refs/") ? normalized : `refs/remotes/${normalized}`;
  try {
    const value = (await capture("git", ["for-each-ref", "--format", "%(objectname)", refPath], { cwd, env: gitEnv() })).trim();
    return value || null;
  } catch {
    return null;
  }
}

async function resolveCurrentBranch(cwd: string): Promise<string> {
  const branch = await readSymbolicBranch(cwd);
  if (!branch) throw new Error("detached HEAD; checkout a branch before pushing");
  return branch;
}

async function hasUpstream(cwd: string, branch: string): Promise<boolean> {
  return Boolean(await readBranchUpstream(cwd, branch));
}

async function readOriginHeadFromRefs(cwd: string): Promise<{ originDefaultRef: string | null; originHead: string | null }> {
  try {
    const line = (await capture("git", ["for-each-ref", "--format", "%(refname:short) %(objectname)", "refs/remotes/origin/HEAD"], {
      cwd,
      env: gitEnv(),
    })).trim();
    if (!line) return { originDefaultRef: null, originHead: null };
    const [ref, oid] = line.split(/\s+/, 2);
    return { originDefaultRef: ref || null, originHead: oid || null };
  } catch {
    return { originDefaultRef: null, originHead: null };
  }
}

async function readOriginDefaultRefFromRemoteShow(cwd: string): Promise<string | null> {
  const symbolic = await readSymbolicRef(cwd, "refs/remotes/origin/HEAD");
  if (symbolic?.startsWith("origin/")) return symbolic;
  return null;
}

async function readSymbolicRef(cwd: string, ref: string): Promise<string | null> {
  try {
    const value = (await capture("git", ["symbolic-ref", "--short", "-q", ref], { cwd, env: gitEnv() })).trim();
    return value || null;
  } catch {
    return null;
  }
}

async function readGitStatusJson(cwd: string): Promise<GitStatusResult> {
  const symbolicBranch = await readSymbolicBranch(cwd);
  const detached = !symbolicBranch;
  const branch = detached ? "HEAD" : symbolicBranch;
  const localHead = await readLocalHead(cwd);

  let upstream: string | null = null;
  if (!detached) {
    upstream = await readBranchUpstream(cwd, branch);
  }

  let ahead: number | null = null;
  let behind: number | null = null;
  if (upstream && localHead) {
    try {
      const counts = (await capture("git", ["rev-list", "--left-right", "--count", `${upstream}...HEAD`], { cwd, env: gitEnv() })).trim();
      const [behindText, aheadText] = counts.split(/\s+/, 2);
      const behindNum = Number.parseInt(behindText || "", 10);
      const aheadNum = Number.parseInt(aheadText || "", 10);
      behind = Number.isFinite(behindNum) ? Math.max(0, behindNum) : 0;
      ahead = Number.isFinite(aheadNum) ? Math.max(0, aheadNum) : 0;
    } catch {
      ahead = null;
      behind = null;
    }
  }

  const porcelain = await capture("git", ["status", "--porcelain"], { cwd, env: gitEnv() });
  const dirty = porcelain.trim().length > 0;

  let { originDefaultRef, originHead } = await readOriginHeadFromRefs(cwd);
  if (!originDefaultRef && upstream?.startsWith("origin/")) {
    originDefaultRef = upstream;
  }
  if (!originDefaultRef) {
    originDefaultRef = await readOriginDefaultRefFromRemoteShow(cwd);
  }
  if (!originHead && originDefaultRef) {
    originHead = await readRemoteRefHead(cwd, originDefaultRef);
  }

  let originRemote = Boolean(upstream || originDefaultRef);
  if (!originRemote) {
    try {
      originRemote = Boolean((await capture("git", ["config", "--get", "remote.origin.url"], { cwd, env: gitEnv() })).trim());
    } catch {
      originRemote = false;
    }
  }

  const hasLocalCommit = Boolean(localHead);
  const needsPush = !detached && hasLocalCommit && (upstream ? (ahead ?? 0) > 0 : true);
  const canPush = !detached && hasLocalCommit && Boolean(branch && branch !== "HEAD") && (Boolean(upstream) || originRemote);
  let pushBlockedReason: string | undefined;
  if (detached) pushBlockedReason = "Detached HEAD; checkout a branch to push.";
  else if (!hasLocalCommit) pushBlockedReason = "No commits yet. Create the first commit before pushing.";
  else if (!branch || branch === "HEAD") pushBlockedReason = "Unknown branch.";
  else if (!upstream && !originRemote) pushBlockedReason = "Missing origin remote.";

  return {
    branch,
    upstream,
    localHead,
    originDefaultRef,
    originHead,
    dirty,
    ahead,
    behind,
    detached,
    needsPush,
    canPush,
    ...(pushBlockedReason ? { pushBlockedReason } : {}),
  };
}

async function pushCurrentBranch(cwd: string, opts?: { quietStdout?: boolean }): Promise<void> {
  const branch = await resolveCurrentBranch(cwd);
  const upstream = await hasUpstream(cwd, branch);
  const args = upstream ? ["push"] : ["push", "--set-upstream", "origin", branch];
  await run("git", args, { cwd, env: gitEnv(), stdout: opts?.quietStdout ? "ignore" : "inherit" });
}

const gitPush = defineCommand({
  meta: {
    name: "push",
    description: "Push current branch to origin (sets upstream when missing).",
  },
  async run() {
    const cwd = findRepoRoot(process.cwd());
    const branch = await resolveCurrentBranch(cwd);
    if (!(await readLocalHead(cwd))) {
      throw new Error("no commits yet; create the first commit before pushing");
    }
    const upstream = await hasUpstream(cwd, branch);
    const args = upstream ? ["push"] : ["push", "--set-upstream", "origin", branch];
    await run("git", args, { cwd, env: gitEnv() });
    console.log(`ok: pushed ${branch}`);
  },
});

const gitSetupSave = defineCommand({
  meta: {
    name: "setup-save",
    description: "Stage, commit, and push setup-owned changes (fleet/ + secrets/) for a host.",
  },
  args: {
    host: { type: "string", required: true, description: "Host name for commit message." },
    json: { type: "boolean", description: "Emit JSON output.", default: false },
  },
  async run({ args }) {
    const cwd = findRepoRoot(process.cwd());
    const host = validateHostName(String((args as any).host || ""));
    const structuredJson = Boolean((args as any).json);

    const changedPaths = await listChangedPaths(cwd);
    const unsafe = changedPaths.filter((p0) => !isSetupOwnedPath(p0));
    if (unsafe.length > 0) {
      throw new Error(formatUnsafePathError(unsafe));
    }

    const branch = await resolveCurrentBranch(cwd);
    let committed = false;
    let pushed = false;

    if (changedPaths.length > 0) {
      await run(
        "git",
        ["add", "-A", "--", "fleet", "secrets"],
        { cwd, env: gitEnv(), stdout: structuredJson ? "ignore" : "inherit" },
      );
      const staged = await listStagedPaths(cwd);
      if (staged.length > 0) {
        const msg = `chore(setup): save ${host} [skip ci]`;
        await run(
          "git",
          ["commit", "-m", msg],
          { cwd, env: gitEnv(), stdout: structuredJson ? "ignore" : "inherit" },
        );
        committed = true;
      }
    }

    const statusNow = await readGitStatusJson(cwd);
    if (statusNow.needsPush && !statusNow.canPush) {
      throw new Error(statusNow.pushBlockedReason || "push blocked");
    }
    if (statusNow.needsPush) {
      await pushCurrentBranch(cwd, { quietStdout: structuredJson });
      pushed = true;
    }

    const sha = await readDetachedHead(cwd);
    const result: GitSetupSaveResult = {
      ok: true,
      host,
      branch,
      sha,
      committed,
      pushed,
      changedPaths,
    };
    if ((args as any).json) {
      console.log(JSON.stringify(result));
      return;
    }
    console.log(`ok: ${committed ? "committed" : "no changes"}${pushed ? " + pushed" : ""} (${sha?.slice(0, 7) || "unknown"})`);
  },
});

const gitStatus = defineCommand({
  meta: {
    name: "status",
    description: "Report git status metadata for deploy flow.",
  },
  args: {
    json: { type: "boolean", description: "Emit JSON output.", default: false },
  },
  async run({ args }) {
    const cwd = findRepoRoot(process.cwd());
    const status = await readGitStatusJson(cwd);
    if (args.json) {
      console.log(JSON.stringify(status));
      return;
    }
    console.log(`branch: ${status.branch || "unknown"}`);
    console.log(`localHead: ${status.localHead || "unknown"}`);
    console.log(`originHead: ${status.originHead || "unknown"}`);
    console.log(`dirty: ${status.dirty ? "yes" : "no"}`);
    console.log(`needsPush: ${status.needsPush ? "yes" : "no"}`);
    if (status.pushBlockedReason) console.log(`pushBlockedReason: ${status.pushBlockedReason}`);
  },
});

export const git = defineCommand({
  meta: {
    name: "git",
    description: "Git helpers.",
  },
  subCommands: {
    push: gitPush,
    "setup-save": gitSetupSave,
    status: gitStatus,
  },
});
