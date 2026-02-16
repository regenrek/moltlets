type FlagValueValidator = (value: string) => string | undefined;

type FlagSpec =
  | { kind: "boolean" }
  | { kind: "value"; validate?: FlagValueValidator };

type ParsedFlagValues = Map<string, string | true>;

export type RunnerCommandResultMode = "log" | "json_small" | "json_large";

export const RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES = 512 * 1024;
export const RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES = 5 * 1024 * 1024;

type CommandSpec = {
  id: string;
  prefix: readonly string[];
  flags: Record<string, FlagSpec>;
  required?: readonly string[];
  postValidate?: (values: ParsedFlagValues) => string | undefined;
  resultMode?: RunnerCommandResultMode;
  resultMaxBytes?: number;
};

const META_MAX = {
  hostName: 128,
  gatewayId: 128,
  configPath: 512,
  argsToken: 512 * 1024,
} as const;

const DOCTOR_SCOPES = new Set(["repo", "bootstrap", "updates", "all"]);
const SECRET_SCOPES = new Set(["bootstrap", "updates", "openclaw", "all"]);
const MODE_SCOPES = new Set(["nixos-anywhere", "image"]);
const TEMPLATE_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TEMPLATE_PATH_RE = /^[A-Za-z0-9._/-]+$/;
const TEMPLATE_REF_RE = /^[A-Za-z0-9._/-]+$/;

function hasForbiddenText(value: string): boolean {
  return value.includes("\0") || value.includes("\n") || value.includes("\r");
}

function validateEnum(values: Set<string>, label: string): FlagValueValidator {
  return (value: string) => (values.has(value) ? undefined : `${label} invalid`);
}

function validateIntRange(params: { min: number; max: number; label: string }): FlagValueValidator {
  return (value: string) => {
    if (!/^[0-9]+$/.test(value)) return `${params.label} invalid`;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < params.min || parsed > params.max) return `${params.label} invalid`;
    return undefined;
  };
}

function validateLiteral(expected: string, label: string): FlagValueValidator {
  return (value: string) => (value === expected ? undefined : `${label} must be ${expected}`);
}

function validateSafeValue(label: string, max: number = META_MAX.configPath): FlagValueValidator {
  return (value: string) => {
    if (!value.trim()) return `${label} required`;
    if (value.length > max) return `${label} too long`;
    if (hasForbiddenText(value)) return `${label} contains forbidden characters`;
    return undefined;
  };
}

function validateTemplateRepo(value: string): string | undefined {
  if (!TEMPLATE_REPO_RE.test(value)) return "template repo must be owner/repo";
  return undefined;
}

function validateTemplatePath(value: string): string | undefined {
  if (value.startsWith("/")) return "template path must be relative";
  if (value.includes("..")) return "template path invalid";
  if (!TEMPLATE_PATH_RE.test(value)) return "template path invalid";
  return undefined;
}

function validateTemplateRef(value: string): string | undefined {
  if (!TEMPLATE_REF_RE.test(value)) return "template ref invalid";
  return undefined;
}

const specGitPush: CommandSpec = {
  id: "git_push",
  prefix: ["git", "push"],
  flags: {},
  resultMode: "log",
};

const specGitStatusJson: CommandSpec = {
  id: "git_status_json",
  prefix: ["git", "status"],
  flags: { "--json": { kind: "boolean" } },
  required: ["--json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specConfigShow: CommandSpec = {
  id: "config_show",
  prefix: ["config", "show"],
  flags: {
    "--pretty": { kind: "value", validate: validateEnum(new Set(["false"]), "--pretty") },
  },
  required: ["--pretty"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specConfigGet: CommandSpec = {
  id: "config_get",
  prefix: ["config", "get"],
  flags: {
    "--path": { kind: "value", validate: validateSafeValue("--path") },
    "--json": { kind: "boolean" },
  },
  required: ["--path", "--json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specConfigReplace: CommandSpec = {
  id: "config_replace",
  prefix: ["config", "replace"],
  flags: {
    "--config-json": { kind: "value", validate: validateSafeValue("--config-json", META_MAX.argsToken) },
  },
  required: ["--config-json"],
};

const specConfigSet: CommandSpec = {
  id: "config_set",
  prefix: ["config", "set"],
  flags: {
    "--path": { kind: "value", validate: validateSafeValue("--path") },
    "--delete": { kind: "boolean" },
    "--value": { kind: "value", validate: validateSafeValue("--value", META_MAX.argsToken) },
    "--value-json": { kind: "value", validate: validateSafeValue("--value-json", META_MAX.argsToken) },
  },
  required: ["--path"],
  postValidate(values) {
    const hasDelete = values.has("--delete");
    const hasValue = values.has("--value");
    const hasValueJson = values.has("--value-json");
    if (Number(hasDelete) + Number(hasValue) + Number(hasValueJson) !== 1) {
      return "config set requires exactly one of --delete, --value, --value-json";
    }
    return undefined;
  },
};

const specConfigBatchSet: CommandSpec = {
  id: "config_batch_set",
  prefix: ["config", "batch-set"],
  flags: {
    "--ops-json": { kind: "value", validate: validateSafeValue("--ops-json", META_MAX.argsToken) },
  },
  required: ["--ops-json"],
};

const specHostAdd: CommandSpec = {
  id: "host_add",
  prefix: ["host", "add"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
  },
  required: ["--host"],
};

const specProjectInit: CommandSpec = {
  id: "project_init",
  prefix: ["project", "init"],
  flags: {
    "--dir": { kind: "value", validate: validateLiteral(".", "--dir") },
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--template": { kind: "value", validate: validateTemplateRepo },
    "--templatePath": { kind: "value", validate: validateTemplatePath },
    "--templateRef": { kind: "value", validate: validateTemplateRef },
  },
  required: ["--dir"],
};

const specDoctor: CommandSpec = {
  id: "doctor",
  prefix: ["doctor"],
  flags: {
    "--scope": { kind: "value", validate: validateEnum(DOCTOR_SCOPES, "--scope") },
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
  },
};

const specBootstrap: CommandSpec = {
  id: "bootstrap",
  prefix: ["bootstrap"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--mode": { kind: "value", validate: validateEnum(MODE_SCOPES, "--mode") },
    "--rev": { kind: "value", validate: validateSafeValue("--rev", 128) },
    "--json": { kind: "boolean" },
    "--lockdown-after": { kind: "boolean" },
    "--force": { kind: "boolean" },
    "--dry-run": { kind: "boolean" },
  },
  required: ["--host", "--json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specLockdown: CommandSpec = {
  id: "lockdown",
  prefix: ["lockdown"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
  },
};

const specSecretsVerify: CommandSpec = {
  id: "secrets_verify",
  prefix: ["secrets", "verify"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--scope": { kind: "value", validate: validateEnum(SECRET_SCOPES, "--scope") },
    "--json": { kind: "boolean" },
  },
};

const specSecretsSync: CommandSpec = {
  id: "secrets_sync",
  prefix: ["secrets", "sync"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
};

const specSecretsSyncPreview: CommandSpec = {
  id: "secrets_sync_preview",
  prefix: ["secrets", "sync"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--preview-json": { kind: "boolean" },
  },
  required: ["--host", "--preview-json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specSecretsInit: CommandSpec = {
  id: "secrets_init",
  prefix: ["secrets", "init"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--scope": { kind: "value", validate: validateEnum(SECRET_SCOPES, "--scope") },
    "--from-json": {
      kind: "value",
      validate: validateEnum(new Set(["__RUNNER_SECRETS_JSON__"]), "--from-json"),
    },
    "--yes": { kind: "boolean" },
    "--allow-placeholders": { kind: "boolean" },
  },
};

const specServerStatus: CommandSpec = {
  id: "server_status",
  prefix: ["server", "status"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--target-host": { kind: "value", validate: validateSafeValue("--target-host", META_MAX.hostName) },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
  required: ["--host", "--ssh-tty"],
};

const specServerAudit: CommandSpec = {
  id: "server_audit",
  prefix: ["server", "audit"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--target-host": { kind: "value", validate: validateSafeValue("--target-host", META_MAX.hostName) },
    "--json": { kind: "boolean" },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
  required: ["--host", "--json", "--ssh-tty"],
};

const specServerLogs: CommandSpec = {
  id: "server_logs",
  prefix: ["server", "logs"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--unit": { kind: "value", validate: validateSafeValue("--unit", 256) },
    "--lines": { kind: "value", validate: validateIntRange({ min: 1, max: 5000, label: "--lines" }) },
    "--since": { kind: "value", validate: validateSafeValue("--since", 128) },
    "--follow": { kind: "boolean" },
    "--target-host": { kind: "value", validate: validateSafeValue("--target-host", META_MAX.hostName) },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
  required: ["--host", "--unit", "--lines", "--ssh-tty"],
};

const specServerRestart: CommandSpec = {
  id: "server_restart",
  prefix: ["server", "restart"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--unit": { kind: "value", validate: validateSafeValue("--unit", 256) },
    "--target-host": { kind: "value", validate: validateSafeValue("--target-host", META_MAX.hostName) },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
  required: ["--host", "--unit", "--ssh-tty"],
};

const specServerUpdateApply: CommandSpec = {
  id: "server_update_apply",
  prefix: ["server", "update", "apply"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--target-host": { kind: "value", validate: validateSafeValue("--target-host", META_MAX.hostName) },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
  required: ["--host", "--ssh-tty"],
};

const specServerUpdateStatus: CommandSpec = {
  id: "server_update_status",
  prefix: ["server", "update", "status"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--target-host": { kind: "value", validate: validateSafeValue("--target-host", META_MAX.hostName) },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
  required: ["--host", "--ssh-tty"],
};

const specServerUpdateLogs: CommandSpec = {
  id: "server_update_logs",
  prefix: ["server", "update", "logs"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--lines": { kind: "value", validate: validateIntRange({ min: 1, max: 5000, label: "--lines" }) },
    "--since": { kind: "value", validate: validateSafeValue("--since", 128) },
    "--follow": { kind: "boolean" },
    "--target-host": { kind: "value", validate: validateSafeValue("--target-host", META_MAX.hostName) },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
  required: ["--host", "--lines", "--ssh-tty"],
};

const specServerChannelsStatus: CommandSpec = {
  id: "server_channels_status",
  prefix: ["server", "channels", "status"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--gateway": { kind: "value", validate: validateSafeValue("--gateway", META_MAX.gatewayId) },
    "--probe": { kind: "boolean" },
    "--timeout": { kind: "value", validate: validateIntRange({ min: 1000, max: 120000, label: "--timeout" }) },
    "--json": { kind: "boolean" },
  },
  required: ["--host", "--gateway", "--timeout"],
};

const specServerChannelsCapabilities: CommandSpec = {
  id: "server_channels_capabilities",
  prefix: ["server", "channels", "capabilities"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--gateway": { kind: "value", validate: validateSafeValue("--gateway", META_MAX.gatewayId) },
    "--channel": { kind: "value", validate: validateSafeValue("--channel", 64) },
    "--account": { kind: "value", validate: validateSafeValue("--account", 64) },
    "--target": { kind: "value", validate: validateSafeValue("--target", 128) },
    "--timeout": { kind: "value", validate: validateIntRange({ min: 1000, max: 120000, label: "--timeout" }) },
    "--json": { kind: "boolean" },
  },
  required: ["--host", "--gateway", "--timeout"],
};

const specServerChannelsLogin: CommandSpec = {
  id: "server_channels_login",
  prefix: ["server", "channels", "login"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--gateway": { kind: "value", validate: validateSafeValue("--gateway", META_MAX.gatewayId) },
    "--channel": { kind: "value", validate: validateSafeValue("--channel", 64) },
    "--account": { kind: "value", validate: validateSafeValue("--account", 64) },
    "--verbose": { kind: "boolean" },
  },
  required: ["--host", "--gateway"],
};

const specServerChannelsLogout: CommandSpec = {
  id: "server_channels_logout",
  prefix: ["server", "channels", "logout"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--gateway": { kind: "value", validate: validateSafeValue("--gateway", META_MAX.gatewayId) },
    "--channel": { kind: "value", validate: validateSafeValue("--channel", 64) },
    "--account": { kind: "value", validate: validateSafeValue("--account", 64) },
  },
  required: ["--host", "--gateway"],
};

const specServerTailscaleIpv4: CommandSpec = {
  id: "server_tailscale_ipv4",
  prefix: ["server", "tailscale-ipv4"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--target-host": { kind: "value", validate: validateSafeValue("--target-host", META_MAX.hostName) },
    "--json": { kind: "boolean" },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
  required: ["--host", "--target-host", "--json", "--ssh-tty"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specServerSshCheck: CommandSpec = {
  id: "server_ssh_check",
  prefix: ["server", "ssh-check"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--target-host": { kind: "value", validate: validateSafeValue("--target-host", META_MAX.hostName) },
    "--json": { kind: "boolean" },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
  required: ["--host", "--target-host", "--json", "--ssh-tty"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specEnvShow: CommandSpec = {
  id: "env_show",
  prefix: ["env", "show"],
  flags: {
    "--json": { kind: "boolean" },
  },
  required: ["--json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specEnvApplyJson: CommandSpec = {
  id: "env_apply_json",
  prefix: ["env", "apply-json"],
  flags: {
    "--from-json": {
      kind: "value",
      validate: validateEnum(new Set(["__RUNNER_INPUT_JSON__"]), "--from-json"),
    },
    "--json": { kind: "boolean" },
  },
  required: ["--from-json", "--json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specEnvTokenKeyringMutate: CommandSpec = {
  id: "env_token_keyring_mutate",
  prefix: ["env", "token-keyring-mutate"],
  flags: {
    "--from-json": {
      kind: "value",
      validate: validateEnum(new Set(["__RUNNER_INPUT_JSON__"]), "--from-json"),
    },
    "--json": { kind: "boolean" },
  },
  required: ["--from-json", "--json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specSetupApply: CommandSpec = {
  id: "setup_apply",
  prefix: ["setup", "apply"],
  flags: {
    "--from-json": {
      kind: "value",
      validate: validateEnum(new Set(["__RUNNER_INPUT_JSON__"]), "--from-json"),
    },
    "--json": { kind: "boolean" },
  },
  required: ["--from-json", "--json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specEnvDetectAgeKey: CommandSpec = {
  id: "env_detect_age_key",
  prefix: ["env", "detect-age-key"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--json": { kind: "boolean" },
  },
  required: ["--json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specEnvGenerateAgeKey: CommandSpec = {
  id: "env_generate_age_key",
  prefix: ["env", "generate-age-key"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--json": { kind: "boolean" },
  },
  required: ["--json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const specOpenclawSchemaFetch: CommandSpec = {
  id: "openclaw_schema_fetch",
  prefix: ["openclaw", "schema", "fetch"],
  flags: {
    "--host": { kind: "value", validate: validateSafeValue("--host", META_MAX.hostName) },
    "--gateway": { kind: "value", validate: validateSafeValue("--gateway", META_MAX.gatewayId) },
    "--ssh-tty": { kind: "value", validate: validateLiteral("false", "--ssh-tty") },
  },
  required: ["--host", "--gateway", "--ssh-tty"],
  resultMode: "json_large",
  resultMaxBytes: RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES,
};

const specOpenclawSchemaStatus: CommandSpec = {
  id: "openclaw_schema_status",
  prefix: ["openclaw", "schema", "status"],
  flags: {
    "--json": { kind: "boolean" },
  },
  required: ["--json"],
  resultMode: "json_small",
  resultMaxBytes: RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
};

const SPECS_BY_KIND: Record<string, CommandSpec[]> = {
  project_init: [specProjectInit],
  custom: [
    specGitStatusJson,
    specConfigShow,
    specConfigGet,
    specSecretsSyncPreview,
    specServerTailscaleIpv4,
    specServerSshCheck,
    specEnvShow,
    specEnvApplyJson,
    specEnvTokenKeyringMutate,
    specEnvDetectAgeKey,
    specEnvGenerateAgeKey,
    specOpenclawSchemaFetch,
    specOpenclawSchemaStatus,
  ],
  config_write: [specHostAdd, specConfigReplace, specConfigSet, specConfigBatchSet],
  workspace_write: [specHostAdd, specConfigReplace, specConfigSet, specConfigBatchSet],
  git_push: [specGitPush],
  doctor: [specDoctor],
  bootstrap: [specBootstrap],
  lockdown: [specLockdown],
  secrets_sync: [specSecretsSync],
  secrets_init: [specSecretsInit],
  secrets_write: [specSecretsInit],
  setup_apply: [specSetupApply],
  secrets_verify: [specSecretsVerify],
  secrets_verify_bootstrap: [specSecretsVerify],
  secrets_verify_openclaw: [specSecretsVerify],
  server_status: [specServerStatus],
  server_logs: [specServerLogs],
  server_audit: [specServerAudit],
  server_restart: [specServerRestart],
  server_update_apply: [specServerUpdateApply],
  server_update_status: [specServerUpdateStatus],
  server_update_logs: [specServerUpdateLogs],
  server_channels: [specServerChannelsStatus, specServerChannelsCapabilities, specServerChannelsLogin, specServerChannelsLogout],
  deploy: [specServerUpdateApply, specServerUpdateStatus, specServerUpdateLogs, specServerStatus],
};

function parseFlags(args: string[], spec: CommandSpec): { ok: true } | { ok: false; error: string } {
  const values: ParsedFlagValues = new Map();
  let idx = spec.prefix.length;
  while (idx < args.length) {
    const token = args[idx]!;
    if (!token.startsWith("--")) return { ok: false, error: `${spec.id}: unexpected positional arg "${token}"` };
    if (token === "--") return { ok: false, error: `${spec.id}: "--" is forbidden` };
    let name = token;
    let inlineValue: string | undefined;
    const eq = token.indexOf("=");
    if (eq >= 0) {
      name = token.slice(0, eq);
      inlineValue = token.slice(eq + 1);
    }
    const flag = spec.flags[name];
    if (!flag) return { ok: false, error: `${spec.id}: unknown flag ${name}` };
    if (values.has(name)) return { ok: false, error: `${spec.id}: duplicate flag ${name}` };

    if (flag.kind === "boolean") {
      if (inlineValue !== undefined) return { ok: false, error: `${spec.id}: ${name} does not take a value` };
      values.set(name, true);
      idx += 1;
      continue;
    }

    let value = inlineValue;
    if (value === undefined) {
      const next = args[idx + 1];
      if (!next || next.startsWith("--")) return { ok: false, error: `${spec.id}: missing value for ${name}` };
      value = next;
      idx += 2;
    } else {
      idx += 1;
    }
    if (!value.trim()) return { ok: false, error: `${spec.id}: empty value for ${name}` };
    if (hasForbiddenText(value)) return { ok: false, error: `${spec.id}: invalid value for ${name}` };
    if (flag.validate) {
      const validationError = flag.validate(value);
      if (validationError) return { ok: false, error: `${spec.id}: ${validationError}` };
    }
    values.set(name, value);
  }

  for (const requiredFlag of spec.required || []) {
    if (!values.has(requiredFlag)) return { ok: false, error: `${spec.id}: missing required ${requiredFlag}` };
  }
  if (spec.postValidate) {
    const error = spec.postValidate(values);
    if (error) return { ok: false, error: `${spec.id}: ${error}` };
  }
  return { ok: true };
}

function matchesPrefix(args: string[], prefix: readonly string[]): boolean {
  if (args.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (args[i] !== prefix[i]) return false;
  }
  return true;
}

export type ResolvedRunnerCommandSpec = {
  id: string;
  resultMode: RunnerCommandResultMode;
  resultMaxBytes?: number;
};

export function resolveCommandSpecForKind(
  kind: string,
  args: string[],
): { ok: true; spec: ResolvedRunnerCommandSpec } | { ok: false; error: string } {
  const specs = SPECS_BY_KIND[kind];
  if (!specs || specs.length === 0) {
    return { ok: false, error: `job ${kind} has no allowed command specification` };
  }
  const prefixCandidates = specs.filter((spec) => matchesPrefix(args, spec.prefix));
  if (prefixCandidates.length === 0) {
    const expected = specs.map((spec) => spec.prefix.join(" ")).join(" | ");
    return { ok: false, error: `job ${kind} command not allowlisted (expected: ${expected})` };
  }
  for (const spec of prefixCandidates) {
    const parsed = parseFlags(args, spec);
    if (parsed.ok) {
      return {
        ok: true,
        spec: {
          id: spec.id,
          resultMode: spec.resultMode ?? "log",
          resultMaxBytes: spec.resultMaxBytes,
        },
      };
    }
  }
  const fallback = parseFlags(args, prefixCandidates[0]!);
  if (fallback.ok) {
    const spec = prefixCandidates[0]!;
    return {
      ok: true,
      spec: {
        id: spec.id,
        resultMode: spec.resultMode ?? "log",
        resultMaxBytes: spec.resultMaxBytes,
      },
    };
  }
  return { ok: false, error: fallback.error };
}

export function validateArgsForKind(kind: string, args: string[]): { ok: true } | { ok: false; error: string } {
  const resolved = resolveCommandSpecForKind(kind, args);
  return resolved.ok ? { ok: true } : { ok: false, error: resolved.error };
}
