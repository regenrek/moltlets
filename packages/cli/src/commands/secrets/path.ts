import process from "node:process";
import { defineCommand } from "citty";
import { getHostRemoteSecretsDir, getHostSecretsDir } from "@clawlets/core/repo-layout";
import { loadHostContextOrExit } from "@clawlets/core/lib/context";

export const secretsPath = defineCommand({
  meta: {
    name: "path",
    description: "Print local + remote secrets paths for a host.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, hostName } = ctx;
    console.log(`local: ${getHostSecretsDir(layout, hostName)}`);
    console.log(`remote: ${getHostRemoteSecretsDir(hostName)}`);
  },
});
