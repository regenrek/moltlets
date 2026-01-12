import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { loadStack } from "@clawdbot/clawdlets-core/stack";
import { requireStackHostOrExit, resolveHostNameOrExit } from "../../lib/host-resolve.js";

export const secretsPath = defineCommand({
  meta: {
    name: "path",
    description: "Print local + remote secrets paths for a host.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = resolveHostNameOrExit({ cwd: process.cwd(), stackDir: args.stackDir, hostArg: args.host });
    if (!hostName) return;
    const host = requireStackHostOrExit(stack, hostName);
    if (!host) return;
    console.log(`local: ${path.join(layout.stackDir, host.secrets.localDir)}`);
    console.log(`remote: ${host.secrets.remoteDir}`);
  },
});
