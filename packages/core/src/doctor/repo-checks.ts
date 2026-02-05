import fs from "node:fs";
import path from "node:path";
import type { RepoLayout } from "../repo-layout.js";
import { capture } from "../lib/run.js";
import { findInlineScriptingViolations } from "../lib/inline-script-ban.js";
import { validateDocsIndexIntegrity } from "../lib/docs-index.js";
import { validateFleetPolicy, type FleetConfig } from "../lib/fleet-policy.js";
import { evalFleetConfig } from "../lib/fleet-nix-eval.js";
import { ClawletsConfigSchema, type ClawletsConfig } from "../lib/clawlets-config.js";
import { buildOpenClawGatewayConfig } from "../lib/openclaw/config-invariants.js";
import { lintOpenclawSecurityConfig } from "../lib/openclaw/security-lint.js";
import { checkSchemaVsNixOpenclaw } from "./schema-checks.js";
import { findClawdbotSecretViolations, findFleetSecretViolations } from "./repo-checks-secrets.js";
import { evalWheelAccess, getClawletsRevFromFlakeLock } from "./repo-checks-nix.js";
import type { DoctorPush } from "./types.js";
import { dirHasAnyFile, loadKnownBundledSkills, resolveTemplateRoot } from "./util.js";

export type RepoDoctorResult = {
  bundledSkills: string[];
  fleet: FleetConfig | null;
  fleetGateways: string[] | null;
};

function allExist(paths: string[]): { ok: boolean; missing: string[] } {
  const missing = paths.filter((p) => !fs.existsSync(p));
  return { ok: missing.length === 0, missing };
}

export async function addRepoChecks(params: {
  repoRoot: string;
  layout: RepoLayout;
  host: string;
  nixBin: string;
  push: DoctorPush;
}): Promise<RepoDoctorResult> {
  const { repoRoot, layout } = params;

  let fleet: FleetConfig | null = null;
  let fleetGateways: string[] | null = null;
  let clawletsConfig: ClawletsConfig | null = null;
  let templateHostNames: string[] = [];

  params.push({
    scope: "repo",
    status: fs.existsSync(path.join(repoRoot, "flake.nix")) ? "ok" : "missing",
    label: "repo root",
    detail: repoRoot,
  });

  // Check clawlets input in flake.lock (informational)
  {
    const flakeRev = getClawletsRevFromFlakeLock(repoRoot);
    if (flakeRev) {
      params.push({
        scope: "repo",
        status: "ok",
        label: "clawlets flake input",
        detail: `rev: ${flakeRev.slice(0, 12)}...`,
      });
    } else {
      const flakeLockExists = fs.existsSync(path.join(repoRoot, "flake.lock"));
      if (flakeLockExists) {
        // flake.lock exists but no clawlets input - might be a different project type
        params.push({
          scope: "repo",
          status: "warn",
          label: "clawlets flake input",
          detail: "(no clawlets input found in flake.lock)",
        });
      }
      // If flake.lock doesn't exist, skip this check silently (test environments, etc.)
    }
  }

  {
    const checks = await checkSchemaVsNixOpenclaw({ repoRoot });
    for (const check of checks) params.push(check);
  }

  params.push({
    scope: "repo",
    status: fs.existsSync(layout.opentofuDir) ? "ok" : "warn",
    label: "provisioning state dir",
    detail: layout.opentofuDir,
  });

  const templateRoot = resolveTemplateRoot(repoRoot);
  const bundledSkills = loadKnownBundledSkills(repoRoot, templateRoot);
  if (!bundledSkills.ok) {
    params.push({
      scope: "repo",
      status: "missing",
      label: "bundled skills index",
      detail: bundledSkills.errors.join("; "),
    });
  } else {
    params.push({
      scope: "repo",
      status: "ok",
      label: "bundled skills index",
      detail: `(${bundledSkills.skills.length} skills)`,
    });
  }

  {
    const legacyRepoSecretsDir = path.join(repoRoot, "infra", "secrets");

    if (dirHasAnyFile(legacyRepoSecretsDir)) {
      params.push({
        scope: "repo",
        status: "missing",
        label: "public repo hygiene",
        detail: "infra/secrets must not exist (legacy; secrets now live under /secrets and must be sops-encrypted)",
      });
    } else {
      try {
        const out = await capture("git", ["ls-files", "-z", "--", ".clawlets", "infra/secrets", "secrets"], { cwd: repoRoot });
        const tracked = out.split("\0").filter(Boolean);
        const trackedClawlets = tracked.filter((p) => p === ".clawlets" || p.startsWith(".clawlets/"));
        const trackedLegacySecrets = tracked.filter((p) => p === "infra/secrets" || p.startsWith("infra/secrets/"));
        const trackedPlainAgeKeys = tracked.filter((p) => p.startsWith("secrets/") && p.endsWith(".agekey"));

        if (trackedClawlets.length > 0 || trackedLegacySecrets.length > 0 || trackedPlainAgeKeys.length > 0) {
          const bad = [...trackedClawlets, ...trackedLegacySecrets, ...trackedPlainAgeKeys];
          params.push({
            scope: "repo",
            status: "missing",
            label: "public repo hygiene",
            detail: `tracked forbidden paths: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? ` (+${bad.length - 3})` : ""}`,
          });
        } else {
          params.push({
            scope: "repo",
            status: "ok",
            label: "public repo hygiene",
            detail: "(no tracked .clawlets; no infra/secrets; no plaintext *.agekey in /secrets)",
          });
        }
      } catch {
        params.push({
          scope: "repo",
          status: "warn",
          label: "public repo hygiene",
          detail: "(git not available; cannot verify tracked paths)",
        });
      }
    }
  }

  const inlineViolations = findInlineScriptingViolations({ repoRoot });
  if (inlineViolations.length > 0) {
    const first = inlineViolations[0]!;
    params.push({
      scope: "repo",
      status: "missing",
      label: "inline scripting ban",
      detail: `${inlineViolations.length} violation(s) (first: ${path.relative(repoRoot, first.filePath)}:${first.line} ${first.rule})`,
    });
  } else {
    params.push({ scope: "repo", status: "ok", label: "inline scripting ban", detail: "(clean)" });
  }

  {
    const r = validateDocsIndexIntegrity({ repoRoot, templateRoot });
    if (!r.ok) {
      params.push({
        scope: "repo",
        status: "missing",
        label: "docs index integrity",
        detail: r.errors.join("; "),
      });
    } else {
      params.push({
        scope: "repo",
        status: "ok",
        label: "docs index integrity",
        detail: templateRoot
          ? "(docs meta valid; all files exist)"
          : "(docs meta valid; all files exist)",
      });
    }
  }

  {
    const commonDir = path.join(repoRoot, "fleet", "workspaces", "common");
    const required = [
      path.join(commonDir, "AGENTS.md"),
      path.join(commonDir, "SOUL.md"),
      path.join(commonDir, "IDENTITY.md"),
      path.join(commonDir, "TOOLS.md"),
      path.join(commonDir, "USER.md"),
      path.join(commonDir, "HEARTBEAT.md"),
    ];

    const r = allExist(required);
    params.push({
      scope: "repo",
      status: r.ok ? "ok" : "missing",
      label: "fleet workspaces",
      detail: r.ok ? "(common docs present)" : `missing: ${r.missing.map((p) => path.relative(repoRoot, p)).join(", ")}`,
    });

    if (templateRoot) {
      const templateCommonDir = path.join(templateRoot, "fleet", "workspaces", "common");
      const templateRequired = required.map((p) => path.join(templateCommonDir, path.basename(p)));
      const rt = allExist(templateRequired);
      params.push({
        scope: "repo",
        status: rt.ok ? "ok" : "missing",
        label: "template fleet workspaces",
        detail: rt.ok ? "(common docs present)" : `missing: ${rt.missing.map((p) => path.relative(repoRoot, p)).join(", ")}`,
      });
    }
  }

  {
    const scan = findClawdbotSecretViolations(repoRoot);
    if (scan.violations.length > 0) {
      const first = scan.violations[0]!;
      params.push({
        scope: "repo",
        status: "missing",
        label: "clawdbot config secrets",
        detail: `${path.relative(repoRoot, first.file)} matched ${first.label}`,
      });
    } else {
      params.push({
        scope: "repo",
        status: "ok",
        label: "clawdbot config secrets",
        detail: scan.files.length > 0 ? `(scanned ${scan.files.length} clawdbot.json5)` : "(no clawdbot.json5 found)",
      });
    }

    if (templateRoot) {
      const scanTemplate = findClawdbotSecretViolations(templateRoot);
      if (scanTemplate.violations.length > 0) {
        const first = scanTemplate.violations[0]!;
        params.push({
          scope: "repo",
          status: "missing",
          label: "template clawdbot config secrets",
          detail: `${path.relative(repoRoot, first.file)} matched ${first.label}`,
        });
      } else {
        params.push({
          scope: "repo",
          status: "ok",
          label: "template clawdbot config secrets",
          detail:
            scanTemplate.files.length > 0 ? `(scanned ${scanTemplate.files.length} clawdbot.json5)` : "(no clawdbot.json5 found)",
        });
      }
    }
  }

  {
    const scan = findFleetSecretViolations(repoRoot);
    if (scan.violations.length > 0) {
      const first = scan.violations[0]!;
      params.push({
        scope: "repo",
        status: "missing",
        label: "fleet config secrets",
        detail: `${path.relative(repoRoot, first.file)} matched ${first.label}`,
      });
    } else {
      params.push({
        scope: "repo",
        status: "ok",
        label: "fleet config secrets",
        detail: scan.files.length > 0 ? `(scanned ${scan.files.length} clawlets.json)` : "(no clawlets.json found)",
      });
    }

    if (templateRoot) {
      const scanTemplate = findFleetSecretViolations(templateRoot);
      if (scanTemplate.violations.length > 0) {
        const first = scanTemplate.violations[0]!;
        params.push({
          scope: "repo",
          status: "missing",
          label: "template fleet config secrets",
          detail: `${path.relative(repoRoot, first.file)} matched ${first.label}`,
        });
      } else {
        params.push({
          scope: "repo",
          status: "ok",
          label: "template fleet config secrets",
          detail:
            scanTemplate.files.length > 0 ? `(scanned ${scanTemplate.files.length} clawlets.json)` : "(no clawlets.json found)",
        });
      }
    }
  }

  {
    const configPath = layout.clawletsConfigPath;
    if (!fs.existsSync(configPath)) {
      params.push({ scope: "repo", status: "missing", label: "clawlets config", detail: configPath });
    } else {
      try {
        const raw = fs.readFileSync(configPath, "utf8");
        const parsed = JSON.parse(raw);
        clawletsConfig = ClawletsConfigSchema.parse(parsed);
        params.push({ scope: "repo", status: "ok", label: "clawlets config", detail: path.relative(repoRoot, configPath) });
      } catch (e) {
        params.push({ scope: "repo", status: "missing", label: "clawlets config", detail: String((e as Error)?.message || e) });
      }
    }

    if (templateRoot) {
      const templateConfigPath = path.join(templateRoot, "fleet", "clawlets.json");
      if (!fs.existsSync(templateConfigPath)) {
        params.push({ scope: "repo", status: "missing", label: "template clawlets config", detail: templateConfigPath });
      } else {
        try {
          const raw = fs.readFileSync(templateConfigPath, "utf8");
          const parsed = JSON.parse(raw);
          const parsedConfig = ClawletsConfigSchema.parse(parsed);
          templateHostNames = Object.keys(parsedConfig.hosts || {});
          params.push({
            scope: "repo",
            status: "ok",
            label: "template clawlets config",
            detail: path.relative(repoRoot, templateConfigPath),
          });
        } catch (e) {
          params.push({
            scope: "repo",
            status: "missing",
            label: "template clawlets config",
            detail: String((e as Error)?.message || e),
          });
        }
      }
    }

  }

  if (clawletsConfig) {
    const hostNames = Object.keys(clawletsConfig.hosts || {});
    const targetHost = params.host.trim() || clawletsConfig.defaultHost || hostNames[0] || "";
    if (targetHost) {
      const hostCfg = (clawletsConfig.hosts as any)?.[targetHost] || {};
      const gatewaysOrder = Array.isArray(hostCfg.gatewaysOrder) ? hostCfg.gatewaysOrder : [];
      const gatewaysKeys = Object.keys(hostCfg.gateways || {});
      fleetGateways = (gatewaysOrder.length > 0 ? gatewaysOrder : gatewaysKeys)
        .map((id: unknown) => String(id || "").trim())
        .filter(Boolean);
    }

    for (const hostName of hostNames) {
      const hostCfg = (clawletsConfig.hosts as any)?.[hostName] || {};
      const gatewaysOrder = Array.isArray(hostCfg.gatewaysOrder) ? hostCfg.gatewaysOrder : [];
      const gatewaysKeys = Object.keys(hostCfg.gateways || {});
      const gateways = gatewaysOrder.length > 0 ? gatewaysOrder : gatewaysKeys;
      for (const gatewayRaw of gateways) {
        const gatewayId = String(gatewayRaw || "").trim();
        if (!gatewayId) continue;
        try {
          const merged = buildOpenClawGatewayConfig({ config: clawletsConfig, hostName, gatewayId }).merged;
          const report = lintOpenclawSecurityConfig({ openclaw: merged, gatewayId });
          const status = report.summary.critical > 0 ? "missing" : report.summary.warn > 0 ? "warn" : "ok";
          const top = report.findings
            .filter((f) => f.severity === "critical" || f.severity === "warn")
            .slice(0, 2)
            .map((f) => f.id)
            .join(", ");
          const hint = top ? ` (${top}${report.findings.length > 2 ? ` +${report.findings.length - 2}` : ""})` : "";
          params.push({
            scope: "repo",
            status,
            label: `openclaw security (${hostName}/${gatewayId})`,
            detail: `critical=${report.summary.critical} warn=${report.summary.warn} info=${report.summary.info}${hint}`,
          });
        } catch (e) {
          params.push({
            scope: "repo",
            status: "warn",
            label: `openclaw security (${hostName}/${gatewayId})`,
            detail: `unable to lint: ${String((e as Error)?.message || e)}`,
          });
        }
      }
    }
  }

  try {
    const hostNames = clawletsConfig ? Object.keys(clawletsConfig.hosts || {}) : [];
    if (hostNames.length === 0) throw new Error("no hosts found in config");

    for (const hostName of hostNames) {
      const hostFleet = await evalFleetConfig({ repoRoot, nixBin: params.nixBin, hostName });
      if (!fleet) fleet = hostFleet;

      params.push({
        scope: "repo",
        status: hostFleet.gateways.length > 0 ? "ok" : "missing",
        label: `fleet config eval (${hostName})`,
        detail: `(gateways: ${hostFleet.gateways.length})`,
      });

      params.push({
        scope: "repo",
        status: hostFleet.gateways.length > 0 ? "ok" : "warn",
        label: `host gateways list (${hostName})`,
        detail: hostFleet.gateways.length > 0 ? hostFleet.gateways.join(", ") : "(empty)",
      });

      const r = validateFleetPolicy({ filePath: layout.clawletsConfigPath, fleet: hostFleet, knownBundledSkills: bundledSkills.skills });
      if (!r.ok) {
        const first = r.violations[0]!;
        params.push({
          scope: "repo",
          status: "missing",
          label: `fleet policy (${hostName})`,
          detail: `${path.relative(repoRoot, first.filePath)} ${first.message}${first.detail ? ` (${first.detail})` : ""}`,
        });
      } else {
        params.push({ scope: "repo", status: "ok", label: `fleet policy (${hostName})`, detail: "(ok)" });
      }
    }

    if (templateRoot && templateHostNames.length > 0) {
      for (const hostName of templateHostNames) {
        const tplFleet = await evalFleetConfig({ repoRoot: templateRoot, nixBin: params.nixBin, hostName });
        params.push({
          scope: "repo",
          status: tplFleet.gateways.length > 0 ? "ok" : "warn",
          label: `template fleet config eval (${hostName})`,
          detail: `(gateways: ${tplFleet.gateways.length})`,
        });

        const r = validateFleetPolicy({ filePath: path.join(templateRoot, "fleet", "clawlets.json"), fleet: tplFleet, knownBundledSkills: bundledSkills.skills });
        if (!r.ok) {
          const first = r.violations[0]!;
          params.push({
            scope: "repo",
            status: "missing",
            label: `template fleet policy (${hostName})`,
            detail: `${path.relative(repoRoot, first.filePath)} ${first.message}${first.detail ? ` (${first.detail})` : ""}`,
          });
        } else {
          params.push({ scope: "repo", status: "ok", label: `template fleet policy (${hostName})`, detail: "(ok)" });
        }
      }
    }
  } catch (e) {
    params.push({
      scope: "repo",
      status: "missing",
      label: "fleet config eval",
      detail: String((e as Error)?.message || e),
    });
  }

  {
    const wheel = await evalWheelAccess({ repoRoot, nixBin: params.nixBin, host: params.host });
    if (!wheel) {
      params.push({
        scope: "repo",
        status: "warn",
        label: "wheel access",
        detail: "(unable to evaluate nixosConfigurations.<host>.config; skipping wheel checks)",
      });
    } else {
      params.push({
        scope: "repo",
        status: wheel.adminHasWheel ? "missing" : "ok",
        label: "admin wheel access",
        detail: wheel.adminHasWheel ? "(admin is in wheel; violates ops invariants)" : "(admin not in wheel)",
      });

      params.push({
        scope: "repo",
        status: wheel.breakglassHasWheel ? "ok" : "missing",
        label: "breakglass wheel access",
        detail: wheel.breakglassHasWheel
          ? "(breakglass is in wheel)"
          : "(missing breakglass user in wheel; required for recovery without giving admin sudo)",
      });
    }
  }

  return {
    bundledSkills: bundledSkills.skills,
    fleet,
    fleetGateways,
  };
}
