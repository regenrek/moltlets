import { createServerFn } from "@tanstack/react-start"
import {
  ClawletsConfigSchema,
  loadClawletsConfig,
  loadClawletsConfigRaw,
  writeClawletsConfig,
} from "@clawlets/core/lib/clawlets-config"
import { getRepoLayout } from "@clawlets/core/repo-layout"
import fs from "node:fs"
import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawletsEnvTokens } from "~/server/redaction"
import { findBotOpenclawChanges } from "~/sdk/config-helpers"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { mapValidationIssues, runWithEventsAndStatus, type ValidationIssue } from "~/sdk/run-with-events"
import { parseProjectIdInput } from "~/sdk/serverfn-validators"

export const getClawletsConfig = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId, { allowMissing: true })
    if (!fs.existsSync(repoRoot)) {
      const layout = getRepoLayout(repoRoot)
      return {
        repoRoot,
        configPath: layout.clawletsConfigPath,
        config: null,
        json: "",
        missing: true,
      }
    }
    try {
      const { configPath, config } = loadClawletsConfig({ repoRoot })
      const json = JSON.stringify(config, null, 2)
      return {
        repoRoot,
        configPath,
        config: JSON.parse(json) as any,
        json,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.toLowerCase().includes("missing clawlets config")) {
        const match = message.match(/missing clawlets config:\s*(.+)$/i)
        const configPath = match?.[1]?.trim() || ""
        return {
          repoRoot,
          configPath,
          config: null,
          json: "",
          missing: true,
        }
      }
      throw err
    }
  })

export const writeClawletsConfigFile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      next: d["next"] as unknown,
      title: typeof d["title"] === "string" ? d["title"] : "Update fleet/clawlets.json",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)

    const { configPath, config: current } = loadClawletsConfigRaw({ repoRoot })
    const blocked = findBotOpenclawChanges(current, data.next)
    if (blocked) {
      return { ok: false as const, issues: [{ code: "policy", path: blocked.path, message: blocked.message }] }
    }

    const parsed = ClawletsConfigSchema.safeParse(data.next)
    if (!parsed.success) return { ok: false as const, issues: mapValidationIssues(parsed.error.issues as unknown[]) }
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: data.title,
    })

    type WriteConfigResult = { ok: true; runId: typeof runId } | { ok: false; issues: ValidationIssue[] }

    return await runWithEventsAndStatus<WriteConfigResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: "Validating config…" })
        await emit({ level: "info", message: "Writing fleet/clawlets.json…" })
        await writeClawletsConfig({ configPath, config: parsed.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })
