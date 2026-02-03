#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineCommand, runMain } from "citty";
import { baseCommands } from "./commands/registry.js";
import { findPluginByCommand, loadPluginCommand } from "./lib/plugins.js";
import { readCliVersion } from "./lib/version.js";

const main = defineCommand({
  meta: {
    name: "clawlets",
    description: "OpenClaw fleet helper (CLI-first; runtime state in .clawlets/; secrets in /secrets).",
  },
  subCommands: baseCommands,
});

function resolveRuntimeDir(rawArgs: string[]): string | undefined {
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i] || "";
    if (arg === "--runtime-dir" || arg === "--runtimeDir") {
      const next = rawArgs[i + 1];
      if (next) return String(next);
    }
    if (arg.startsWith("--runtime-dir=")) return arg.slice("--runtime-dir=".length);
    if (arg.startsWith("--runtimeDir=")) return arg.slice("--runtimeDir=".length);
  }
  return undefined;
}

function findCommandToken(rawArgs: string[]): { index: number; command: string } | null {
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg) continue;
    if (arg === "--") continue;
    if (arg === "--runtime-dir" || arg === "--runtimeDir") {
      i += 1;
      continue;
    }
    if (arg.startsWith("--runtime-dir=") || arg.startsWith("--runtimeDir=")) {
      continue;
    }
    if (arg.startsWith("-")) continue;
    return { index: i, command: arg };
  }
  return null;
}

export async function mainEntry(): Promise<void> {
  const [nodeBin, script, ...rest] = process.argv;
  const normalized = rest.filter((a) => a !== "--");
  if (normalized.includes("--version") || normalized.includes("-v")) {
    console.log(readCliVersion());
    process.exit(0);
    return;
  }
  process.argv = [nodeBin!, script!, ...normalized];
  const runtimeDir = resolveRuntimeDir(normalized);
  const commandToken = findCommandToken(normalized);
  const command = commandToken?.command ?? "";
  const pluginMatch = findPluginByCommand({ cwd: process.cwd(), runtimeDir, command });
  if (pluginMatch) {
    const command = await loadPluginCommand(pluginMatch);
    const rawArgs = commandToken ? normalized.slice(commandToken.index + 1) : [];
    await runMain(command, { rawArgs });
    return;
  }
  await runMain(main);
}

function shouldRunMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryUrl = pathToFileURL(path.resolve(entry)).href;
  return entryUrl === import.meta.url;
}

if (shouldRunMain()) {
  void mainEntry();
}
