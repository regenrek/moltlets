import fs from "node:fs/promises";
import { validateArgsForKind } from "./runner-command-policy-args.js";
import {
  type RunnerCommandPayloadMeta,
  validateRunnerJobPayload,
  buildDefaultArgsForJobKind,
  buildCreateImportCommand,
} from "./runner-command-policy.js";

type RunnerCommandExecutable = "clawlets" | "git";

type ResolveArgsResult =
  | { ok: true; payloadMeta: RunnerCommandPayloadMeta; kind: string; exec: RunnerCommandExecutable; args: string[] }
  | { ok: false; error: string };

async function ensureRepoRootEmpty(repoRoot: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = String(repoRoot || "").trim();
  if (!normalized) return { ok: false, error: "repoRoot required" };
  try {
    const stat = await fs.stat(normalized);
    if (!stat.isDirectory()) return { ok: false, error: `repoRoot is not a directory: ${normalized}` };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { ok: false, error: `repoRoot missing: ${normalized}` };
    return { ok: false, error: `repoRoot check failed: ${String((err as Error)?.message || err)}` };
  }
  try {
    const entries = await fs.readdir(normalized);
    if (entries.length > 0) return { ok: false, error: `repoRoot must be empty for create/import: ${normalized}` };
  } catch (err) {
    return { ok: false, error: `repoRoot readability check failed: ${String((err as Error)?.message || err)}` };
  }
  return { ok: true };
}

export async function resolveRunnerJobCommand(params: {
  kind: string;
  payloadMeta?: unknown;
  repoRoot: string;
}): Promise<ResolveArgsResult> {
  const validated = validateRunnerJobPayload({
    kind: params.kind,
    payloadMeta: params.payloadMeta,
  });
  if (!validated.ok) return validated;

  const createImportCommand = buildCreateImportCommand(validated.kind, validated.payloadMeta);
  const fallbackArgs =
    validated.payloadMeta.args ||
    buildDefaultArgsForJobKind({
      kind: validated.kind,
      payloadMeta: validated.payloadMeta,
    });
  const command =
    createImportCommand ||
    (fallbackArgs && fallbackArgs.length > 0
      ? {
          exec: "clawlets" as const,
          args: fallbackArgs,
        }
      : null);
  if (!command) return { ok: false, error: `job ${validated.kind} requires payloadMeta.args` };
  if (command.exec === "clawlets") {
    const commandValidation = validateArgsForKind(validated.kind, command.args);
    if (!commandValidation.ok) return commandValidation;
  }

  if (validated.kind === "project_init" || validated.kind === "project_import") {
    const emptyCheck = await ensureRepoRootEmpty(params.repoRoot);
    if (!emptyCheck.ok) return emptyCheck;
  }
  return { ok: true, kind: validated.kind, payloadMeta: validated.payloadMeta, exec: command.exec, args: command.args };
}
