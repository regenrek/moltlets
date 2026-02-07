import { createServerFn } from "@tanstack/react-start"
import { loadClawletsConfig } from "@clawlets/core/lib/config/clawlets-config"

import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { resolveClawletsCliEntry } from "~/server/clawlets-cli"
import { readClawletsEnvTokens } from "~/server/redaction"
import { getClawletsCliEnv } from "~/server/run-env"
import { runWithEvents, spawnCommandCapture } from "~/server/run-manager"
import { getAdminProjectContext } from "~/sdk/project"
import { parseProjectHostScopeInput, parseProjectRunHostScopeInput } from "~/sdk/runtime"
import { resolveHostFromConfig } from "./helpers"
import { requireAdminAndBoundRun } from "~/sdk/runtime/server"
import { getSecretsVerifyRunKind } from "./run-kind"

export const secretsVerifyStart = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostScopeInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config } = loadClawletsConfig({ repoRoot })
    const host = resolveHostFromConfig(config, data.host, { requireKnownHost: true })
    const runKind = getSecretsVerifyRunKind(data.scope)

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: runKind,
      title: `Secrets verify (${host}, scope=${data.scope})`,
      host,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.verify",
      target: { host },
      data: { runId, scope: data.scope },
    })
    return { runId }
  })

export const secretsVerifyExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectRunHostScopeInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const expectedKind = getSecretsVerifyRunKind(data.scope)
    const { repoRoot } = await requireAdminAndBoundRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind,
    })

    try {
      const { config } = loadClawletsConfig({ repoRoot })
      if (!config.hosts[data.host]) throw new Error(`unknown host: ${data.host}`)
      const redactTokens = await readClawletsEnvTokens(repoRoot)
      const cliEntry = resolveClawletsCliEntry()
      const cliEnv = getClawletsCliEnv()

      await runWithEvents({
        client,
        runId: data.runId,
        redactTokens,
        fn: async (emit) => {
          await emit({ level: "info", message: "Running secrets verify…" })
        },
      })

      const captured = await spawnCommandCapture({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args: [cliEntry, "secrets", "verify", "--host", data.host, "--scope", data.scope, "--json"],
        env: cliEnv.env,
        envAllowlist: cliEnv.envAllowlist,
        redactTokens,
        maxCaptureBytes: 512_000,
        allowNonZeroExit: true,
      })

      let parsed: any = null
      try {
        parsed = JSON.parse(captured.stdout || "")
      } catch {
        parsed = { raw: captured.stdout || "", stderr: captured.stderr || "", exitCode: captured.exitCode }
      }

      const hasMissing =
        Array.isArray(parsed?.results) &&
        parsed.results.some((r: any) => r?.status === "missing")
      const ok = captured.exitCode === 0 && !hasMissing

      await client.mutation(api.runs.setStatus, {
        runId: data.runId,
        status: ok ? "succeeded" : "failed",
        errorMessage: ok ? undefined : "secrets verify failed",
      })

      await client.mutation(api.runEvents.appendBatch, {
        runId: data.runId,
        events: [
          {
            ts: Date.now(),
            level: ok ? "info" : "error",
            message: ok ? "Secrets verify ok" : "Secrets verify failed",
            meta: { kind: "phase", phase: "command_end" },
          },
        ],
      })

      return { ok, result: parsed }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "failed", errorMessage: message })
      return { ok: false as const, result: { error: message } }
    }
  })
