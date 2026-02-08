import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadFullConfig, type ClawletsConfig } from "@clawlets/core/lib/config/clawlets-config";
import { getRepoLayout, getHostSecretsDir } from "@clawlets/core/repo-layout";
import { buildFleetSecretsPlan } from "@clawlets/core/lib/secrets/plan";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";
import type { RunnerMetadataSyncPayload } from "./client.js";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function listGatewayIds(hostCfg: any): string[] {
  const order = Array.isArray(hostCfg?.gatewaysOrder) ? hostCfg.gatewaysOrder : [];
  const keys = Object.keys(hostCfg?.gateways || {});
  const source = order.length > 0 ? order : keys;
  return source.map((value: unknown) => coerceTrimmedString(value)).filter(Boolean);
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function str(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function countAny(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return undefined;
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((entry) => String(entry || "").trim()).filter(Boolean))).toSorted();
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return sortedUnique(Object.keys(value as Record<string, unknown>));
}

function agentIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const list = (value as Record<string, unknown>)["list"];
  if (!Array.isArray(list)) return [];
  return sortedUnique(
    list.map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? coerceTrimmedString((entry as Record<string, unknown>)["id"])
        : "",
    ),
  );
}

function parsePort(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
  }
  return undefined;
}

function scopeBySecretName(config: ClawletsConfig, hostName: string): Map<string, "bootstrap" | "updates" | "openclaw"> {
  const plan = buildFleetSecretsPlan({ config, hostName, scope: "all" });
  const out = new Map<string, "bootstrap" | "updates" | "openclaw">();
  for (const spec of plan.scopes.bootstrapRequired) out.set(spec.name, "bootstrap");
  for (const spec of plan.scopes.openclawRequired) out.set(spec.name, "openclaw");
  for (const spec of [...plan.required, ...plan.optional]) {
    if (!out.has(spec.name)) out.set(spec.name, "updates");
  }
  return out;
}

async function inferSecretStatus(params: {
  repoRoot: string;
  hostName: string;
  secretName: string;
}): Promise<"configured" | "missing"> {
  const layout = getRepoLayout(params.repoRoot);
  const hostDir = getHostSecretsDir(layout, params.hostName);
  const secretPath = path.join(hostDir, `${params.secretName}.yaml`);
  try {
    await fs.access(secretPath);
    return "configured";
  } catch {
    return "missing";
  }
}

export async function buildMetadataSnapshot(params: {
  repoRoot: string;
  lastRunId?: string;
  lastRunStatus?: "queued" | "running" | "succeeded" | "failed" | "canceled";
}): Promise<RunnerMetadataSyncPayload> {
  const layout = getRepoLayout(params.repoRoot);
  const payload: RunnerMetadataSyncPayload = {
    projectConfigs: [],
    hosts: [],
    gateways: [],
    secretWiring: [],
  };

  const configFiles: Array<{ type: "fleet" | "raw"; path: string }> = [
    { type: "fleet", path: layout.clawletsConfigPath },
    { type: "raw", path: layout.openclawConfigPath },
  ];
  for (const file of configFiles) {
    try {
      const text = await fs.readFile(file.path, "utf8");
      payload.projectConfigs.push({
        type: file.type,
        path: path.relative(params.repoRoot, file.path).replace(/\\/g, "/"),
        sha256: sha256Hex(text),
      });
    } catch (err) {
      payload.projectConfigs.push({
        type: file.type,
        path: path.relative(params.repoRoot, file.path).replace(/\\/g, "/"),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const loaded = loadFullConfig({ repoRoot: params.repoRoot });
    const config = loaded.config;
    const hostNames = Object.keys(config.hosts || {}).toSorted();
    const now = Date.now();

    for (const hostName of hostNames) {
      const hostCfg: any = (config.hosts as any)?.[hostName] || {};
      const gatewayIds = listGatewayIds(hostCfg);
      payload.hosts.push({
        hostName,
        patch: {
          lastSeenAt: now,
          lastStatus: "online",
          lastRunId: params.lastRunId,
          lastRunStatus: params.lastRunStatus,
          desired: {
            enabled: bool(hostCfg.enable),
            provider: str(hostCfg?.provisioning?.provider),
            region: str(hostCfg?.provisioning?.region),
            gatewayCount: gatewayIds.length,
            gatewayArchitecture: str((config as any)?.fleet?.gatewayArchitecture),
            updateRing: str(hostCfg?.updateRing),
            theme: str(hostCfg?.theme?.color),
            sshExposureMode: str(hostCfg?.sshExposure?.mode),
            targetHost: str(hostCfg?.targetHost),
            tailnetMode: str(hostCfg?.tailnet?.mode),
            selfUpdateEnabled: bool(hostCfg?.selfUpdate?.enable),
            selfUpdateChannel: str(hostCfg?.selfUpdate?.channel),
            selfUpdateBaseUrlCount: countAny(hostCfg?.selfUpdate?.baseUrls),
            selfUpdatePublicKeyCount: countAny(hostCfg?.selfUpdate?.publicKeys),
            selfUpdateAllowUnsigned: bool(hostCfg?.selfUpdate?.allowUnsigned),
          },
        },
      });

      for (const gatewayId of gatewayIds) {
        const gatewayCfg: any = hostCfg?.gateways?.[gatewayId] || {};
        const mergedOpenclaw = (loaded.openclaw as any)?.hosts?.[hostName]?.gateways?.[gatewayId] ?? {};
        const channels = sortedUnique([
          ...objectKeys(gatewayCfg?.channels),
          ...objectKeys(mergedOpenclaw?.channels),
        ]);
        const personas = sortedUnique([
          ...agentIds(gatewayCfg?.agents),
          ...agentIds(mergedOpenclaw?.agents),
          ...objectKeys(mergedOpenclaw?.personas),
        ]);
        payload.gateways.push({
          hostName,
          gatewayId,
          patch: {
            lastSeenAt: now,
            lastStatus: "unknown",
            desired: {
              enabled: bool(gatewayCfg?.enable) ?? bool(mergedOpenclaw?.enable),
              channelCount: channels.length,
              personaCount: personas.length,
              provider: str(gatewayCfg?.provider) ?? str(mergedOpenclaw?.provider),
              channels,
              personaIds: personas,
              port: parsePort(
                mergedOpenclaw?.gateway?.port,
                mergedOpenclaw?.port,
                gatewayCfg?.openclaw?.gateway?.port,
                gatewayCfg?.openclaw?.port,
              ),
            },
          },
        });
      }

      const plan = buildFleetSecretsPlan({ config, hostName, scope: "all" });
      const scopeMap = scopeBySecretName(config, hostName);
      for (const spec of [...plan.required, ...plan.optional]) {
        const status = await inferSecretStatus({
          repoRoot: params.repoRoot,
          hostName,
          secretName: spec.name,
        });
        payload.secretWiring.push({
          hostName,
          secretName: spec.name,
          scope: scopeMap.get(spec.name) ?? "updates",
          status,
          required: !spec.optional,
          lastVerifiedAt: now,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    payload.projectConfigs.push({
      type: "fleet",
      path: "fleet/clawlets.json",
      error: `metadata parse failed: ${message}`,
    });
  }

  return payload;
}
