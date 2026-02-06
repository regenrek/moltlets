import { getAtPath } from "../storage/object-path.js";
import { extractEnvVarRef, HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR, HOOKS_TOKEN_ENV_VAR, skillApiKeyEnvVar } from "../secrets/env-vars.js";
import { listOpenclawChannelPolicySpecs, toDotPath } from "./channel-policy-metadata.js";
import { listPinnedChannelUiModels } from "./channel-ui-metadata.js";

export type OpenclawSecuritySeverity = "info" | "warn" | "critical";

export type OpenclawSecurityFinding = {
  severity: OpenclawSecuritySeverity;
  id: string;
  title: string;
  detail: string;
  remediation?: string;
};

export type OpenclawSecuritySummary = {
  critical: number;
  warn: number;
  info: number;
};

export type OpenclawSecurityLintReport = {
  summary: OpenclawSecuritySummary;
  findings: OpenclawSecurityFinding[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function hasEnvVarRef(value: string): boolean {
  return extractEnvVarRef(value) !== null;
}

function envVarRef(envVar: string): string {
  return "${" + envVar + "}";
}

function splitDotPath(path: string): string[] {
  return path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function summarize(findings: OpenclawSecurityFinding[]): OpenclawSecuritySummary {
  const out: OpenclawSecuritySummary = { critical: 0, warn: 0, info: 0 };
  for (const finding of findings) {
    if (finding.severity === "critical") out.critical += 1;
    else if (finding.severity === "warn") out.warn += 1;
    else out.info += 1;
  }
  return out;
}

function normalizeDmPolicy(value: string): "pairing" | "allowlist" | "open" | "disabled" | "" {
  const policy = value.trim();
  if (policy === "pairing" || policy === "allowlist" || policy === "open" || policy === "disabled") return policy;
  return "";
}

function normalizeGroupPolicy(value: string): "allowlist" | "open" | "disabled" | "" {
  const policy = value.trim();
  if (policy === "allowlist" || policy === "open" || policy === "disabled") return policy;
  return "";
}

function isChannelEnabled(channelCfg: unknown): boolean {
  if (!isPlainObject(channelCfg)) return false;
  const enabled = channelCfg.enabled;
  return enabled !== false;
}

function addInlineSecretFinding(params: {
  botLabel: string;
  findings: OpenclawSecurityFinding[];
  path: string[];
  title: string;
  expected?: string;
  remediation: string;
}): void {
  const pathLabel = params.path.join(".");
  params.findings.push({
    id: `inlineSecret.${pathLabel}`,
    severity: "critical",
    title: `${params.botLabel}${params.title}`,
    detail: params.expected ? `${pathLabel} is set inline (expected ${params.expected}).` : `${pathLabel} is set inline.`,
    remediation: params.remediation,
  });
}

export function lintOpenclawSecurityConfig(params: {
  openclaw: unknown;
  gatewayId?: string;
}): OpenclawSecurityLintReport {
  const cfg = isPlainObject(params.openclaw) ? params.openclaw : {};
  const findings: OpenclawSecurityFinding[] = [];
  const gatewayLabel = params.gatewayId ? `gateway=${params.gatewayId} ` : "";

  for (const channel of listPinnedChannelUiModels()) {
    for (const tokenField of channel.tokenFields) {
      const path = splitDotPath(tokenField.path);
      const value = readString(getAtPath(cfg, path));
      if (!value || hasEnvVarRef(value)) continue;
      addInlineSecretFinding({
        botLabel: gatewayLabel,
        findings,
        path,
        title: `${channel.name} token looks inline`,
        expected: `"${envVarRef(tokenField.envVar)}"`,
        remediation: `Replace with "${envVarRef(tokenField.envVar)}" and wire the env var via secrets (do not store tokens in config).`,
      });
    }
  }

  {
    const token = readString(getAtPath(cfg, ["gateway", "auth", "token"]));
    if (token && !hasEnvVarRef(token)) {
      addInlineSecretFinding({
        botLabel: gatewayLabel,
        findings,
        path: ["gateway", "auth", "token"],
        title: "Gateway auth token looks inline",
        expected: `"${envVarRef("OPENCLAW_GATEWAY_TOKEN")}"`,
        remediation: "Remove the inline value. clawlets manages the gateway token at runtime; do not store it in config.",
      });
    }
  }

  {
    const token = readString(getAtPath(cfg, ["hooks", "token"]));
    if (token && !hasEnvVarRef(token)) {
      addInlineSecretFinding({
        botLabel: gatewayLabel,
        findings,
        path: ["hooks", "token"],
        title: "Hooks token looks inline",
        expected: `"${envVarRef(HOOKS_TOKEN_ENV_VAR)}"`,
        remediation: `Replace with "${envVarRef(HOOKS_TOKEN_ENV_VAR)}" and wire it via secrets (do not store tokens in config).`,
      });
    }
  }

  {
    const token = readString(getAtPath(cfg, ["hooks", "gmail", "pushToken"]));
    if (token && !hasEnvVarRef(token)) {
      addInlineSecretFinding({
        botLabel: gatewayLabel,
        findings,
        path: ["hooks", "gmail", "pushToken"],
        title: "Hooks Gmail push token looks inline",
        expected: `"${envVarRef(HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR)}"`,
        remediation:
          `Replace with "${envVarRef(HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR)}" and wire it via secrets (do not store tokens in config).`,
      });
    }
  }

  {
    const entries = getAtPath(cfg, ["skills", "entries"]);
    if (isPlainObject(entries)) {
      for (const [skill, entry] of Object.entries(entries)) {
        if (!isPlainObject(entry)) continue;
        const apiKey = readString((entry as any).apiKey);
        if (!apiKey || hasEnvVarRef(apiKey)) continue;
        const envVar = skillApiKeyEnvVar(skill);
        addInlineSecretFinding({
          botLabel: gatewayLabel,
          findings,
          path: ["skills", "entries", skill, "apiKey"],
          title: `Skill ${skill} apiKey looks inline`,
          expected: `"${envVarRef(envVar)}"`,
          remediation: `Replace with "${envVarRef(envVar)}" and wire the env var via secrets (do not store API keys in config).`,
        });
      }
    }
  }

  {
    const tailscaleMode = readString(getAtPath(cfg, ["gateway", "tailscale", "mode"]));
    if (tailscaleMode === "funnel") {
      findings.push({
        id: "gateway.tailscale.funnel",
        severity: "critical",
        title: `${gatewayLabel}Gateway is publicly exposed (Tailscale Funnel)`,
        detail: 'gateway.tailscale.mode="funnel"',
        remediation: 'Set gateway.tailscale.mode="serve" (tailnet-only) or "off".',
      });
    }
  }

  {
    const allowInsecureAuth = getAtPath(cfg, ["gateway", "controlUi", "allowInsecureAuth"]);
    if (allowInsecureAuth === true) {
      findings.push({
        id: "gateway.controlUi.allowInsecureAuth",
        severity: "warn",
        title: `${gatewayLabel}Control UI insecure auth enabled`,
        detail: "gateway.controlUi.allowInsecureAuth=true (token-only auth; skips device pairing)",
        remediation: "Prefer HTTPS (Tailscale Serve) or keep Control UI on loopback.",
      });
    }
  }

  {
    const redactSensitive = readString(getAtPath(cfg, ["logging", "redactSensitive"]));
    if (redactSensitive === "off") {
      findings.push({
        id: "logging.redactSensitive.off",
        severity: "warn",
        title: `${gatewayLabel}Sensitive redaction disabled`,
        detail: 'logging.redactSensitive="off"',
        remediation: 'Set logging.redactSensitive="tools" (recommended).',
      });
    }
  }

  const dmScopeRaw = readString(getAtPath(cfg, ["session", "dmScope"]));
  const dmScope = dmScopeRaw || "main";
  if (dmScopeRaw && dmScope !== "main" && dmScope !== "per-channel-peer" && dmScope !== "per-channel" && dmScope !== "per-peer") {
    findings.push({
      id: "session.dmScope.unknown",
      severity: "warn",
      title: `${gatewayLabel}Unknown DM session scope`,
      detail: `session.dmScope="${dmScopeRaw}"`,
    });
  }

  {
    const groupPolicyRaw = readString(getAtPath(cfg, ["channels", "defaults", "groupPolicy"]));
    const groupPolicy = normalizeGroupPolicy(groupPolicyRaw);
    if (groupPolicyRaw && !groupPolicy) {
      findings.push({
        id: "channels.defaults.groupPolicy.unknown",
        severity: "warn",
        title: `${gatewayLabel}Default group policy looks invalid`,
        detail: `channels.defaults.groupPolicy="${groupPolicyRaw}"`,
      });
    } else if (groupPolicy === "open") {
      findings.push({
        id: "channels.defaults.groupPolicy.open",
        severity: "critical",
        title: `${gatewayLabel}Default group policy is open`,
        detail: 'channels.defaults.groupPolicy="open"',
        remediation: 'Set channels.defaults.groupPolicy="allowlist" (recommended).',
      });
    }
  }

  for (const spec of listOpenclawChannelPolicySpecs()) {
    const channelCfg = getAtPath(cfg, ["channels", spec.channelId]);
    if (!isChannelEnabled(channelCfg)) continue;

    if (spec.dmPolicyPath && spec.dmAllowFromPath) {
      const policyPath = [...spec.dmPolicyPath];
      const allowFromPath = [...spec.dmAllowFromPath];
      const policyRaw = readString(getAtPath(cfg, policyPath));
      const policy = normalizeDmPolicy(policyRaw || "pairing");

      const allowFrom = readStringArray(getAtPath(cfg, allowFromPath));
      const allowFromSet = new Set(allowFrom.map((value) => value.trim()).filter(Boolean));
      const hasWildcard = allowFromSet.has("*");
      allowFromSet.delete("*");
      const allowCount = allowFromSet.size;
      const isMultiUserDm = hasWildcard || allowCount > 1;

      if (policyRaw && !policy) {
        findings.push({
          id: `channels.${spec.channelId}.dmPolicy.unknown`,
          severity: "warn",
          title: `${gatewayLabel}${spec.label} DM policy looks invalid`,
          detail: `${toDotPath(policyPath)}="${policyRaw}"`,
        });
      } else {
        if (policy === "open") {
          findings.push({
            id: `channels.${spec.channelId}.dmPolicy.open`,
            severity: "critical",
            title: `${gatewayLabel}${spec.label} DMs are open to anyone`,
            detail: `${toDotPath(policyPath)}="open"`,
            remediation: 'Use "pairing" or "allowlist" (recommended).',
          });

          if (!hasWildcard) {
            findings.push({
              id: `channels.${spec.channelId}.dmPolicy.open_missing_wildcard`,
              severity: "critical",
              title: `${gatewayLabel}${spec.label} DM policy misconfigured`,
              detail: `"open" requires ${toDotPath(allowFromPath)} to include "*"`,
              remediation: "Either add \"*\" to allowFrom or switch dmPolicy away from \"open\".",
            });
          }
        }

        if (dmScope === "main" && isMultiUserDm) {
          findings.push({
            id: "session.dmScope.multi_user_dm",
            severity: "warn",
            title: `${gatewayLabel}${spec.label} DMs share the main session`,
            detail:
              `session.dmScope="main" with ${toDotPath(allowFromPath)} allowing multiple senders; risk of cross-user context leakage`,
            remediation: 'Set session.dmScope="per-channel-peer".',
          });
        }
      }
    }

    if (spec.groupPolicyPath && spec.groupAllowFromPath) {
      const policyPath = [...spec.groupPolicyPath];
      const allowFromPath = [...spec.groupAllowFromPath];
      const policyRaw = readString(getAtPath(cfg, policyPath));
      const policy = normalizeGroupPolicy(policyRaw);

      if (policyRaw && !policy) {
        findings.push({
          id: `channels.${spec.channelId}.groupPolicy.unknown`,
          severity: "warn",
          title: `${gatewayLabel}${spec.label} group policy looks invalid`,
          detail: `${toDotPath(policyPath)}="${policyRaw}"`,
        });
      } else if (policy === "open") {
        findings.push({
          id: `channels.${spec.channelId}.groupPolicy.open`,
          severity: "critical",
          title: `${gatewayLabel}${spec.label} groups are open to anyone`,
          detail: `${toDotPath(policyPath)}="open"`,
          remediation: 'Use "allowlist" (recommended) or "disabled".',
        });
      }

      const allowFrom = readStringArray(getAtPath(cfg, allowFromPath));
      if (allowFrom.some((value) => value.trim() === "*")) {
        findings.push({
          id: `channels.${spec.channelId}.groupAllowFrom.wildcard`,
          severity: "critical",
          title: `${gatewayLabel}${spec.label} group sender allowlist contains wildcard`,
          detail: `${toDotPath(allowFromPath)} includes "*" (any group member)`,
          remediation: "Remove \"*\" and use explicit sender ids/usernames.",
        });
      }
    }
  }

  return { summary: summarize(findings), findings };
}
