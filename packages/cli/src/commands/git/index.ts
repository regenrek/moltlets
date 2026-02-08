import process from "node:process";
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

async function resolveCurrentBranch(cwd: string): Promise<string> {
  const branch = (await capture("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, env: gitEnv() })).trim();
  if (!branch || branch === "HEAD") throw new Error("detached HEAD; checkout a branch before pushing");
  return branch;
}

async function hasUpstream(cwd: string, branch: string): Promise<boolean> {
  try {
    const upstream = (await capture("git", ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], { cwd, env: gitEnv() })).trim();
    return Boolean(upstream);
  } catch {
    return false;
  }
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
  try {
    const remoteShow = await capture("git", ["remote", "show", "-n", "origin"], { cwd, env: gitEnv() });
    const match = remoteShow.match(/HEAD branch:\s+([^\s]+)/);
    if (match?.[1]) return `origin/${match[1]}`;
  } catch {
    return null;
  }
  return null;
}

async function readGitStatusJson(cwd: string): Promise<GitStatusResult> {
  const branchRaw = (await capture("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, env: gitEnv() })).trim();
  const detached = !branchRaw || branchRaw === "HEAD";
  const branch = detached ? "HEAD" : branchRaw;
  const localHead = (await capture("git", ["rev-parse", "HEAD"], { cwd, env: gitEnv() })).trim() || null;

  let upstream: string | null = null;
  if (!detached) {
    try {
      upstream = (await capture("git", ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], { cwd, env: gitEnv() })).trim() || null;
    } catch {
      upstream = null;
    }
  }

  let ahead: number | null = null;
  let behind: number | null = null;
  if (upstream) {
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
  if (!originDefaultRef) {
    originDefaultRef = await readOriginDefaultRefFromRemoteShow(cwd);
    if (originDefaultRef) {
      try {
        originHead = (await capture("git", ["rev-parse", originDefaultRef], { cwd, env: gitEnv() })).trim() || null;
      } catch {
        originHead = null;
      }
    }
  }

  let originRemote = Boolean(upstream || originDefaultRef);
  if (!originRemote) {
    try {
      originRemote = Boolean((await capture("git", ["config", "--get", "remote.origin.url"], { cwd, env: gitEnv() })).trim());
    } catch {
      originRemote = false;
    }
  }

  const needsPush = !detached && (upstream ? (ahead ?? 0) > 0 : true);
  const canPush = !detached && Boolean(branch && branch !== "HEAD") && (Boolean(upstream) || originRemote);
  let pushBlockedReason: string | undefined;
  if (detached) pushBlockedReason = "Detached HEAD; checkout a branch to push.";
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

const gitPush = defineCommand({
  meta: {
    name: "push",
    description: "Push current branch to origin (sets upstream when missing).",
  },
  async run() {
    const cwd = findRepoRoot(process.cwd());
    const branch = await resolveCurrentBranch(cwd);
    const upstream = await hasUpstream(cwd, branch);
    const args = upstream ? ["push"] : ["push", "--set-upstream", "origin", branch];
    await run("git", args, { cwd, env: gitEnv() });
    console.log(`ok: pushed ${branch}`);
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
    status: gitStatus,
  },
});
