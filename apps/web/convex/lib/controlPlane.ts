import { Base64 } from "convex/values";
import { CONTROL_PLANE_TEXT_LIMITS } from "@clawlets/core/lib/runtime/control-plane-constants";
import { fail } from "./errors";

export const CONTROL_PLANE_LIMITS = CONTROL_PLANE_TEXT_LIMITS;

const SECRETISH_FIELDS = new Set([
  "value",
  "token",
  "key",
  "password",
  "secret",
  "apikey",
  "privatekey",
]);

export function ensureBoundedString(input: string, field: string, max: number): string {
  const value = String(input ?? "").trim();
  if (!value) fail("conflict", `${field} required`);
  if (value.length > max) fail("conflict", `${field} too long`);
  return value;
}

export function ensureOptionalBoundedString(
  input: string | undefined,
  field: string,
  max: number,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value) return undefined;
  if (value.length > max) fail("conflict", `${field} too long`);
  return value;
}

export function assertNoSecretLikeKeys(value: unknown, field = "payload"): void {
  visit(value, field);
}

function visit(value: unknown, path: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      visit(value[i], `${path}[${i}]`);
    }
    return;
  }

  const row = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(row)) {
    const lower = key.trim().toLowerCase();
    if (SECRETISH_FIELDS.has(lower)) {
      fail("conflict", `${path}.${key} forbidden`);
    }
    visit(child, `${path}.${key}`);
  }
}

function asBoundedOptional(value: unknown, field: string, max: number = CONTROL_PLANE_LIMITS.hash): string | undefined {
  return ensureOptionalBoundedString(typeof value === "string" ? value : undefined, field, max);
}

function asOptionalCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(10_000, Math.trunc(value)));
}

export function sanitizeDesiredHostSummary(
  desired: unknown,
  fieldPrefix = "hosts.patch.desired",
): {
  enabled?: boolean;
  provider?: string;
  region?: string;
  gatewayCount?: number;
  gatewayArchitecture?: string;
  updateRing?: string;
  theme?: string;
  sshExposureMode?: string;
  targetHost?: string;
  tailnetMode?: string;
  selfUpdateEnabled?: boolean;
  selfUpdateChannel?: string;
  selfUpdateBaseUrlCount?: number;
  selfUpdatePublicKeyCount?: number;
  selfUpdateAllowUnsigned?: boolean;
} | undefined {
  if (!desired || typeof desired !== "object" || Array.isArray(desired)) return undefined;
  const row = desired as Record<string, unknown>;
  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : undefined,
    provider: asBoundedOptional(row.provider, `${fieldPrefix}.provider`),
    region: asBoundedOptional(row.region, `${fieldPrefix}.region`),
    gatewayCount: asOptionalCount(row.gatewayCount),
    gatewayArchitecture: asBoundedOptional(row.gatewayArchitecture, `${fieldPrefix}.gatewayArchitecture`),
    updateRing: asBoundedOptional(row.updateRing, `${fieldPrefix}.updateRing`),
    theme: asBoundedOptional(row.theme, `${fieldPrefix}.theme`),
    sshExposureMode: asBoundedOptional(row.sshExposureMode, `${fieldPrefix}.sshExposureMode`),
    targetHost: asBoundedOptional(row.targetHost, `${fieldPrefix}.targetHost`, CONTROL_PLANE_LIMITS.projectConfigPath),
    tailnetMode: asBoundedOptional(row.tailnetMode, `${fieldPrefix}.tailnetMode`),
    selfUpdateEnabled: typeof row.selfUpdateEnabled === "boolean" ? row.selfUpdateEnabled : undefined,
    selfUpdateChannel: asBoundedOptional(row.selfUpdateChannel, `${fieldPrefix}.selfUpdateChannel`),
    selfUpdateBaseUrlCount: asOptionalCount(row.selfUpdateBaseUrlCount),
    selfUpdatePublicKeyCount: asOptionalCount(row.selfUpdatePublicKeyCount),
    selfUpdateAllowUnsigned: typeof row.selfUpdateAllowUnsigned === "boolean" ? row.selfUpdateAllowUnsigned : undefined,
  };
}

export function sanitizeDesiredGatewaySummary(
  desired: unknown,
  fieldPrefix = "gateways.patch.desired",
): {
  enabled?: boolean;
  channelCount?: number;
  personaCount?: number;
  provider?: string;
  channels?: string[];
  personaIds?: string[];
  port?: number;
} | undefined {
  if (!desired || typeof desired !== "object" || Array.isArray(desired)) return undefined;
  const row = desired as Record<string, unknown>;
  const channelsRaw = Array.isArray(row.channels) ? row.channels.slice(0, 256) : [];
  const personaIdsRaw = Array.isArray(row.personaIds) ? row.personaIds.slice(0, 256) : [];
  const channels = channelsRaw
    .map((entry) => asBoundedOptional(entry, `${fieldPrefix}.channels`))
    .filter((entry): entry is string => Boolean(entry));
  const personaIds = personaIdsRaw
    .map((entry) => asBoundedOptional(entry, `${fieldPrefix}.personaIds`))
    .filter((entry): entry is string => Boolean(entry));
  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : undefined,
    channelCount: asOptionalCount(row.channelCount),
    personaCount: asOptionalCount(row.personaCount),
    provider: asBoundedOptional(row.provider, `${fieldPrefix}.provider`),
    channels: channels.length > 0 ? channels : undefined,
    personaIds: personaIds.length > 0 ? personaIds : undefined,
    port:
      typeof row.port === "number" && Number.isFinite(row.port)
        ? Math.max(1, Math.min(65_535, Math.trunc(row.port)))
        : undefined,
  };
}

export async function sha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error("crypto.subtle.digest unavailable");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("crypto.getRandomValues unavailable");
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Base64.fromByteArray(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
