import fs from "node:fs/promises";
import process from "node:process";
import { run } from "@clawlets/core/lib/runtime/run";
import { printHuman } from "./shared.js";
import type { UiMode } from "./types.js";

async function ensureUiDirExists(uiDir: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    stat = await fs.stat(uiDir);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory()) throw new Error(`convex dir not found: ${uiDir}`);
}

export async function startUi(params: {
  convexDir: string;
  mode: UiMode;
  uiPort: number;
  siteUrl: string;
  json: boolean;
}): Promise<void> {
  if (params.mode === "none") return;
  await ensureUiDirExists(params.convexDir);
  const env = {
    ...process.env,
    SITE_URL: params.siteUrl,
    VITE_SITE_URL: params.siteUrl,
    PORT: String(params.uiPort),
  };

  if (params.mode === "prod") {
    printHuman(params.json, "step: building web app");
    await run("pnpm", ["-C", params.convexDir, "build"], {
      env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    printHuman(params.json, "step: starting web app (prod)");
    await run("pnpm", ["-C", params.convexDir, "start"], {
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return;
  }

  const devArgs =
    params.uiPort === 3000
      ? ["-C", params.convexDir, "dev"]
      : ["-C", params.convexDir, "dev:web", "--", "--port", String(params.uiPort)];
  printHuman(params.json, `step: starting web app (${params.mode})`);
  await run("pnpm", devArgs, {
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
}
