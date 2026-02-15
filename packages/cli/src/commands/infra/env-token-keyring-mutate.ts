import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { loadDeployCreds, updateDeployCredsEnvFile } from "@clawlets/core/lib/infra/deploy-creds";
import {
  generateProjectTokenKeyId,
  parseProjectTokenKeyring,
  PROJECT_TOKEN_KEY_ID_MAX_CHARS,
  PROJECT_TOKEN_KEY_LABEL_MAX_CHARS,
  PROJECT_TOKEN_KEYRING_MAX_ITEMS,
  PROJECT_TOKEN_VALUE_MAX_CHARS,
  resolveActiveProjectTokenEntry,
  serializeProjectTokenKeyring,
} from "@clawlets/shared/lib/project-token-keyring";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";

type TokenKeyringKind = "hcloud" | "tailscale";
type TokenKeyringAction = "add" | "remove" | "select";

type TokenKeyringConfig = {
  kind: TokenKeyringKind;
  keyringKey: "HCLOUD_TOKEN_KEYRING" | "TAILSCALE_AUTH_KEY_KEYRING";
  activeKey: "HCLOUD_TOKEN_KEYRING_ACTIVE" | "TAILSCALE_AUTH_KEY_KEYRING_ACTIVE";
};

const TOKEN_KEYRING_CONFIG: Record<TokenKeyringKind, TokenKeyringConfig> = {
  hcloud: {
    kind: "hcloud",
    keyringKey: "HCLOUD_TOKEN_KEYRING",
    activeKey: "HCLOUD_TOKEN_KEYRING_ACTIVE",
  },
  tailscale: {
    kind: "tailscale",
    keyringKey: "TAILSCALE_AUTH_KEY_KEYRING",
    activeKey: "TAILSCALE_AUTH_KEY_KEYRING_ACTIVE",
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function requireJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid --from-json payload (expected JSON object)");
  }
  const obj = asRecord(parsed);
  if (!obj) throw new Error("invalid --from-json payload (expected JSON object)");
  return obj;
}

function parseKind(raw: unknown): TokenKeyringKind {
  const value = coerceTrimmedString(raw).toLowerCase();
  if (value === "hcloud" || value === "tailscale") return value;
  throw new Error("kind must be hcloud or tailscale");
}

function parseAction(raw: unknown): TokenKeyringAction {
  const value = coerceTrimmedString(raw).toLowerCase();
  if (value === "add" || value === "remove" || value === "select") return value;
  throw new Error("action must be add, remove, or select");
}

function ensureNoForbiddenText(value: string, field: string): void {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new Error(`${field} contains forbidden characters`);
  }
}

export const envTokenKeyringMutate = defineCommand({
  meta: {
    name: "token-keyring-mutate",
    description: "Mutate deploy creds project token keyrings (Hetzner/Tailscale) from a JSON file.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    fromJson: { type: "string", required: true, description: "Path to JSON object with kind/action/value fields." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const runtimeDir = (args as any).runtimeDir as string | undefined;
    const envFile = (args as any).envFile as string | undefined;
    const repoRoot = findRepoRoot(cwd);
    const fromJsonRaw = String((args as any).fromJson || "").trim();
    if (!fromJsonRaw) throw new Error("missing --from-json");
    const fromJsonPath = path.isAbsolute(fromJsonRaw) ? fromJsonRaw : path.resolve(cwd, fromJsonRaw);

    const payload = requireJsonObject(fs.readFileSync(fromJsonPath, "utf8"));
    const kind = parseKind(payload.kind);
    const action = parseAction(payload.action);
    const keyIdRaw = coerceTrimmedString(payload.keyId);
    const labelRaw = coerceTrimmedString(payload.label);
    const valueRaw = coerceTrimmedString(payload.value);

    if (keyIdRaw && keyIdRaw.length > PROJECT_TOKEN_KEY_ID_MAX_CHARS) {
      throw new Error(`keyId too long (max ${PROJECT_TOKEN_KEY_ID_MAX_CHARS} characters)`);
    }
    if (labelRaw && labelRaw.length > PROJECT_TOKEN_KEY_LABEL_MAX_CHARS) {
      throw new Error(`label too long (max ${PROJECT_TOKEN_KEY_LABEL_MAX_CHARS} characters)`);
    }
    if (action === "add" && !valueRaw) throw new Error("value required for add");
    if (action === "add" && valueRaw.length > PROJECT_TOKEN_VALUE_MAX_CHARS) {
      throw new Error(`value too long (max ${PROJECT_TOKEN_VALUE_MAX_CHARS} characters)`);
    }
    if ((action === "remove" || action === "select") && !keyIdRaw) throw new Error("keyId required");

    if (keyIdRaw) ensureNoForbiddenText(keyIdRaw, "keyId");
    if (labelRaw) ensureNoForbiddenText(labelRaw, "label");
    if (valueRaw) ensureNoForbiddenText(valueRaw, "value");

    const cfg = TOKEN_KEYRING_CONFIG[kind];
    const deployCreds = loadDeployCreds({ cwd, runtimeDir, envFile });
    const currentKeyring = parseProjectTokenKeyring((deployCreds.values as any)[cfg.keyringKey]);
    const currentActiveId = coerceTrimmedString((deployCreds.values as any)[cfg.activeKey]);
    const currentActiveEntry = resolveActiveProjectTokenEntry({ keyring: currentKeyring, activeId: currentActiveId });

    let nextKeyringJson: string | undefined;
    let nextActiveId: string | undefined;
    let createdKeyId: string | undefined;
    let updatedKeys: string[] = [];

    if (action === "add") {
      if (currentKeyring.items.length >= PROJECT_TOKEN_KEYRING_MAX_ITEMS) {
        throw new Error(`keyring full (max ${PROJECT_TOKEN_KEYRING_MAX_ITEMS} items)`);
      }
      const existingIds = new Set(currentKeyring.items.map((row) => row.id));
      let nextId = keyIdRaw || generateProjectTokenKeyId(labelRaw);
      if (existingIds.has(nextId)) throw new Error("keyId already exists");
      if (!nextId) throw new Error("unable to allocate keyId");

      const nextItems = [
        ...currentKeyring.items,
        {
          id: nextId,
          label: labelRaw,
          value: valueRaw,
        },
      ];
      nextKeyringJson = serializeProjectTokenKeyring({ items: nextItems });
      nextActiveId = currentActiveEntry?.id || nextId;
      createdKeyId = nextId;
      updatedKeys = [cfg.keyringKey, cfg.activeKey];
    } else if (action === "remove") {
      const nextItems = currentKeyring.items.filter((row) => row.id !== keyIdRaw);
      if (nextItems.length === currentKeyring.items.length) throw new Error("key not found");
      const nextActiveCandidate = currentActiveEntry?.id === keyIdRaw ? "" : currentActiveEntry?.id || "";
      const nextActiveResolved =
        nextActiveCandidate && nextItems.some((row) => row.id === nextActiveCandidate)
          ? nextActiveCandidate
          : nextItems[0]?.id || "";
      nextKeyringJson = serializeProjectTokenKeyring({ items: nextItems });
      nextActiveId = nextActiveResolved;
      updatedKeys = [cfg.keyringKey, cfg.activeKey];
    } else {
      if (!currentKeyring.items.some((row) => row.id === keyIdRaw)) throw new Error("key not found");
      nextActiveId = keyIdRaw;
      updatedKeys = [cfg.activeKey];
    }

    const updates: Record<string, string> = {};
    if (typeof nextKeyringJson === "string") updates[cfg.keyringKey] = nextKeyringJson;
    if (typeof nextActiveId === "string") updates[cfg.activeKey] = nextActiveId;

    const writeResult = await updateDeployCredsEnvFile({
      repoRoot,
      runtimeDir,
      envFile,
      updates: updates as any,
    });

    const resolvedKeyring = parseProjectTokenKeyring(
      typeof nextKeyringJson === "string" ? nextKeyringJson : (deployCreds.values as any)[cfg.keyringKey],
    );
    const resolvedActiveId = coerceTrimmedString(
      typeof nextActiveId === "string" ? nextActiveId : (deployCreds.values as any)[cfg.activeKey],
    );
    const hasActive = Boolean(resolveActiveProjectTokenEntry({ keyring: resolvedKeyring, activeId: resolvedActiveId }));

    const out = {
      ok: true as const,
      kind,
      action,
      updatedKeys: writeResult.updatedKeys,
      keyringKey: cfg.keyringKey,
      activeKey: cfg.activeKey,
      itemCount: resolvedKeyring.items.length,
      hasActive,
      ...(createdKeyId ? { keyId: createdKeyId } : {}),
    };

    if ((args as any).json) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    console.log(`ok: updated ${updatedKeys.join(", ")}`);
  },
});

