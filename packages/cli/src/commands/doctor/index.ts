import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { collectDoctorChecks } from "@clawlets/core/doctor";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { resolveHostNameOrExit } from "@clawlets/core/lib/host/host-resolve";
import { renderDoctorReport } from "../../lib/doctor-render.js";

export const doctor = defineCommand({
  meta: {
    name: "doctor",
    description: "Validate repo + runtime inputs for deploying a host.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    scope: {
      type: "string",
      description: "Which checks to run: repo | bootstrap | updates | all (default: all).",
      default: "all",
    },
    json: { type: "boolean", description: "Output JSON.", default: false },
    "show-ok": { type: "boolean", description: "Show ok checks too.", default: false },
    strict: { type: "boolean", description: "Fail on warn too (deploy gating).", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const scopeRaw = String(args.scope || "all").trim();
    if (scopeRaw !== "repo" && scopeRaw !== "bootstrap" && scopeRaw !== "updates" && scopeRaw !== "all") {
      throw new Error(`invalid --scope: ${scopeRaw} (expected repo|bootstrap|updates|all)`);
    }
    const scope = scopeRaw as "repo" | "bootstrap" | "updates" | "all";

    if (scope === "repo") {
      const repoRoot = findRepoRoot(cwd);
      const templateSource = path.join(repoRoot, "config", "template-source.json");
      const clawletsConfig = path.join(repoRoot, "fleet", "clawlets.json");
      if (fs.existsSync(templateSource) && !fs.existsSync(clawletsConfig)) {
        console.log("note: CLI repo detected; run doctor in a project repo or via template-e2e.");
        return;
      }
    }

    const hostName = resolveHostNameOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!hostName) return;

    const checks = await collectDoctorChecks({
      cwd,
      runtimeDir: (args as any).runtimeDir,
      envFile: (args as any).envFile,
      host: hostName,
      scope,
    });

    if (args.json) {
      console.log(JSON.stringify({ scope: scopeRaw, host: hostName, checks }, null, 2));
    } else {
      console.log(renderDoctorReport({ checks, host: hostName, scope, strict: args.strict, showOk: Boolean((args as any)["show-ok"]) }));
    }

    if (checks.some((c) => c.status === "missing")) process.exitCode = 1;
    if (args.strict && checks.some((c) => c.status === "warn")) process.exitCode = 1;
  },
});
