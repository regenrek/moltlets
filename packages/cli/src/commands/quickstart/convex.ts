import fs from "node:fs/promises";
import path from "node:path";
import { parseDotenv, upsertDotenv } from "@clawlets/core/lib/storage/dotenv-file";
import { writeFileAtomic } from "@clawlets/core/lib/storage/fs-safe";
import { capture, captureWithInput, run } from "@clawlets/core/lib/runtime/run";
import { deriveConvexSiteUrl, printHuman, randomSecret } from "./shared.js";
import type { ConvexBootstrapResult } from "./types.js";

async function ensureConvexDirExists(convexDir: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    stat = await fs.stat(convexDir);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory()) throw new Error(`convex dir not found: ${convexDir}`);
}

async function ensureConvexLogin(params: {
  convexDir: string;
  confirm: boolean;
}): Promise<void> {
  try {
    await capture("npx", ["convex", "whoami"], {
      cwd: params.convexDir,
      stdin: "ignore",
      maxOutputBytes: 16 * 1024,
    });
    return;
  } catch {
    if (!params.confirm) {
      throw new Error(`convex auth required; run \`cd ${params.convexDir} && npx convex login\` first`);
    }
    await run("npx", ["convex", "login"], {
      cwd: params.convexDir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  }
}

async function enforceStrictEnvFilePermissions(filePath: string): Promise<void> {
  await fs.chmod(filePath, 0o600);
  const stat = await fs.stat(filePath);
  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`${filePath} must be mode 0600 (current: ${mode.toString(8)})`);
  }
}

async function writeDotenvSecure(params: {
  envFilePath: string;
  currentText: string;
  mergedText: string;
}): Promise<void> {
  if (params.mergedText !== params.currentText) {
    await writeFileAtomic(params.envFilePath, params.mergedText, { mode: 0o600 });
  }
  await enforceStrictEnvFilePermissions(params.envFilePath);
}

async function syncConvexEnv(params: {
  convexDir: string;
  siteUrl: string;
  convexSiteUrl: string;
  betterAuthSecret: string;
}): Promise<void> {
  await run("npx", ["convex", "env", "set", "SITE_URL", params.siteUrl], {
    cwd: params.convexDir,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  await run("npx", ["convex", "env", "set", "CONVEX_SITE_URL", params.convexSiteUrl], {
    cwd: params.convexDir,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  await captureWithInput(
    "npx",
    ["convex", "env", "set", "BETTER_AUTH_SECRET"],
    `${params.betterAuthSecret}\n`,
    {
      cwd: params.convexDir,
      maxOutputBytes: 16 * 1024,
      redact: [params.betterAuthSecret],
      redactOutput: true,
    },
  );
}

export async function bootstrapConvex(params: {
  convexDir: string;
  siteUrl: string;
  confirm: boolean;
  json: boolean;
}): Promise<ConvexBootstrapResult> {
  await ensureConvexDirExists(params.convexDir);
  const envFilePath = path.join(params.convexDir, ".env.local");

  printHuman(params.json, "step: checking convex auth");
  await ensureConvexLogin({ convexDir: params.convexDir, confirm: params.confirm });

  printHuman(params.json, "step: bootstrapping convex deployment");
  await run("npx", ["convex", "dev", "--once"], {
    cwd: params.convexDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  let currentText = "";
  try {
    currentText = await fs.readFile(envFilePath, "utf8");
  } catch {
    currentText = "";
  }
  const parsed = parseDotenv(currentText);
  const deployment = String(parsed["CONVEX_DEPLOYMENT"] || "").trim();
  const convexUrl = String(parsed["VITE_CONVEX_URL"] || "").trim();
  const existingSiteUrl = String(parsed["VITE_CONVEX_SITE_URL"] || "").trim();
  const derivedSiteUrl = deriveConvexSiteUrl(convexUrl);
  const convexSiteUrl = existingSiteUrl || derivedSiteUrl || "";
  const betterAuthSecret = String(parsed["BETTER_AUTH_SECRET"] || "").trim() || randomSecret();
  if (!deployment) {
    throw new Error(`CONVEX_DEPLOYMENT missing in ${envFilePath}; run \`npx convex dev --once\` in ${params.convexDir}`);
  }
  if (!convexUrl) {
    throw new Error(`VITE_CONVEX_URL missing in ${envFilePath}; run \`npx convex dev --once\` in ${params.convexDir}`);
  }
  if (!convexSiteUrl) {
    throw new Error(`cannot derive VITE_CONVEX_SITE_URL from VITE_CONVEX_URL (${convexUrl})`);
  }

  const merged = upsertDotenv(currentText, {
    VITE_SITE_URL: params.siteUrl,
    SITE_URL: params.siteUrl,
    CONVEX_DEPLOYMENT: deployment,
    VITE_CONVEX_URL: convexUrl,
    VITE_CONVEX_SITE_URL: convexSiteUrl,
    BETTER_AUTH_SECRET: betterAuthSecret,
  });
  await writeDotenvSecure({
    envFilePath,
    currentText,
    mergedText: merged,
  });

  printHuman(params.json, "step: syncing convex env vars");
  await syncConvexEnv({
    convexDir: params.convexDir,
    siteUrl: params.siteUrl,
    convexSiteUrl,
    betterAuthSecret,
  });

  return {
    convexDir: params.convexDir,
    envFilePath,
    deployment,
    convexUrl,
    convexSiteUrl,
    siteUrl: params.siteUrl,
  };
}
