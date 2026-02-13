import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { updateDeployCredsEnvFile } from "@clawlets/core/lib/infra/deploy-creds";
import { bootstrapConvex } from "./convex";
import { ensureNix, ensurePnpmInstall } from "./nix";
import {
  confirmOrAbort,
  enforceJsonUiInvariant,
  normalizeInstallNixMode,
  normalizeSiteUrl,
  normalizeUiMode,
  parseUiPort,
  printHuman,
  requireNode22OrNewer,
  requireSupportedPlatform,
  resolveConvexDir,
} from "./shared";
import type { ConvexBootstrapResult, QuickstartSummary } from "./types";
import { startUi } from "./ui";

export const quickstart = defineCommand({
  meta: {
    name: "quickstart",
    description: "Set up Nix + Convex + dashboard dev server on a fresh machine.",
  },
  args: {
    confirm: { type: "boolean", description: "Confirm before installing or writing files.", default: true },
    installNix: { type: "string", description: "Nix install policy: auto|always|never.", default: "auto" },
    nixBin: { type: "string", description: "Override nix binary path and persist to .clawlets/env." },
    skipNix: { type: "boolean", description: "Alias for --install-nix=never.", default: false },
    setupConvex: { type: "boolean", description: "Run Convex bootstrap.", default: true },
    skipConvex: { type: "boolean", description: "Skip Convex bootstrap.", default: false },
    convexDir: { type: "string", description: "Web app dir containing Convex config.", default: "apps/web" },
    siteUrl: { type: "string", description: "Site URL for local auth/callback config.", default: "http://localhost:3000" },
    ui: { type: "string", description: "UI mode: dev|prod|none.", default: "dev" },
    skipUi: { type: "boolean", description: "Alias for --ui=none.", default: false },
    uiPort: { type: "string", description: "UI port.", default: "3000" },
    json: { type: "boolean", description: "Emit machine-readable summary.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const jsonMode = Boolean((args as any).json);
    const confirm = Boolean((args as any).confirm);
    const installNixMode = normalizeInstallNixMode((args as any).installNix, (args as any).skipNix);
    const uiMode = normalizeUiMode((args as any).ui, (args as any).skipUi);
    enforceJsonUiInvariant({ jsonMode, uiMode });
    const uiPort = parseUiPort((args as any).uiPort);
    const siteUrl = normalizeSiteUrl((args as any).siteUrl, uiPort);
    const convexDirArg = String((args as any).convexDir || "apps/web").trim() || "apps/web";
    const convexDir = await resolveConvexDir({
      repoRoot,
      convexDirArg,
    });
    const setupConvex = !Boolean((args as any).skipConvex) && Boolean((args as any).setupConvex);
    const explicitNixBin = String((args as any).nixBin || "").trim();

    const platform = requireSupportedPlatform();
    const nodeVersion = requireNode22OrNewer();

    await confirmOrAbort({
      confirm,
      message: `Run quickstart in ${repoRoot}? This may install dependencies and write local env files.`,
      initialValue: true,
    });

    printHuman(jsonMode, `step: preflight ok (platform=${platform}, node=${nodeVersion})`);
    const nix = await ensureNix({
      installMode: installNixMode,
      confirm,
      json: jsonMode,
      explicitNixBin: explicitNixBin || undefined,
    });
    printHuman(jsonMode, `ok: nix ${nix.version} (${nix.nixBin})`);

    await updateDeployCredsEnvFile({
      repoRoot,
      updates: { NIX_BIN: nix.nixBin },
    });
    printHuman(jsonMode, "ok: persisted NIX_BIN to .clawlets/env");

    await ensurePnpmInstall({
      repoRoot,
      json: jsonMode,
    });
    printHuman(jsonMode, "ok: workspace dependencies installed");

    let convex: ConvexBootstrapResult | null = null;
    if (setupConvex) {
      convex = await bootstrapConvex({
        convexDir,
        siteUrl,
        confirm,
        json: jsonMode,
      });
      printHuman(
        jsonMode,
        `ok: convex ready (${convex.deployment}) and env written (${path.relative(repoRoot, convex.envFilePath)})`,
      );
    } else {
      printHuman(jsonMode, "ok: skipped Convex bootstrap");
    }

    const summary: QuickstartSummary = {
      ok: true,
      repoRoot,
      platform,
      nodeVersion,
      nix: {
        status: nix.status,
        nixBin: nix.nixBin,
        nixVersion: nix.version,
      },
      convex: convex
        ? {
            status: "configured",
            convexDir,
            envFile: convex.envFilePath,
            deployment: convex.deployment,
            convexUrl: convex.convexUrl,
            convexSiteUrl: convex.convexSiteUrl,
            siteUrl: convex.siteUrl,
          }
        : {
            status: "skipped",
            convexDir,
            siteUrl,
          },
      ui: uiMode === "none"
        ? {
            status: "skipped",
            mode: uiMode,
            url: siteUrl,
            port: uiPort,
          }
        : {
            status: "started",
            mode: uiMode,
            url: siteUrl,
            port: uiPort,
          },
    };

    if (jsonMode) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`ok: quickstart prepared ${siteUrl}`);
      console.log("next: open UI -> Setup -> Runner -> create token -> start runner");
    }

    if (uiMode !== "none") {
      await startUi({
        convexDir,
        mode: uiMode,
        uiPort,
        siteUrl,
        json: jsonMode,
      });
    }
  },
});
