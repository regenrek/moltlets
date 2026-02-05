import type { SecretFileSpec } from "../../secret-wiring.js";
import type { SecretSource, SecretSpec } from "../../secrets-plan.js";
import { isPlainObject } from "../env-vars.js";

export type SecretSpecAccumulator = {
  name: string;
  kind: SecretSpec["kind"];
  scope: SecretSpec["scope"];
  sources: Set<SecretSource>;
  envVars: Set<string>;
  gateways: Set<string>;
  help?: string;
  optional: boolean;
  fileId?: string;
};

const SOURCE_PRIORITY: SecretSource[] = ["channel", "model", "provider", "custom"];

export function pickPrimarySource(sources: Set<SecretSource>): SecretSource {
  for (const source of SOURCE_PRIORITY) {
    if (sources.has(source)) return source;
  }
  return "custom";
}

export function recordSecretSpec(
  map: Map<string, SecretSpecAccumulator>,
  params: {
    name: string;
    kind: SecretSpec["kind"];
    scope: SecretSpec["scope"];
    source: SecretSource;
    optional: boolean;
    envVar?: string;
    gateway?: string;
    help?: string;
    fileId?: string;
  },
): void {
  const key = params.name;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      name: params.name,
      kind: params.kind,
      scope: params.scope,
      sources: new Set([params.source]),
      envVars: new Set(params.envVar ? [params.envVar] : []),
      gateways: new Set(params.gateway ? [params.gateway] : []),
      help: params.help,
      optional: params.optional,
      fileId: params.fileId,
    });
    return;
  }

  existing.sources.add(params.source);
  if (params.envVar) existing.envVars.add(params.envVar);
  if (params.gateway) existing.gateways.add(params.gateway);
  if (params.help && !existing.help) existing.help = params.help;
  if (!params.optional) existing.optional = false;
  if (existing.scope !== params.scope) {
    existing.scope = existing.scope === "host" || params.scope === "host" ? "host" : "gateway";
  }
  if (!existing.fileId && params.fileId) existing.fileId = params.fileId;
}

export function normalizeSecretFiles(value: unknown): Record<string, SecretFileSpec> {
  if (!isPlainObject(value)) return {};
  return value as Record<string, SecretFileSpec>;
}

export function normalizeEnvVarPaths(pathsByVar: Record<string, string[]>): void {
  for (const [envVar, paths] of Object.entries(pathsByVar)) {
    if (!paths || paths.length === 0) continue;
    pathsByVar[envVar] = Array.from(new Set(paths)).sort();
  }
}
