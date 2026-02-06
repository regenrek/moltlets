import { createServerFn } from "@tanstack/react-start"
import type { OpenclawSchemaLiveResult, OpenclawSchemaStatusResult } from "~/server/openclaw-schema.server"
import { parseProjectHostBotInput, parseProjectIdInput } from "~/sdk/serverfn-validators"
import { sanitizeErrorMessage } from "@clawlets/core/lib/safe-error"

export const getOpenclawSchemaLive = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostBotInput)
  .handler(async ({ data }) => {
    try {
      const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
      return await fetchOpenclawSchemaLive({ projectId: data.projectId, host: data.host, botId: data.botId })
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to fetch schema. Check logs.")
      return { ok: false as const, message } satisfies OpenclawSchemaLiveResult
    }
  })

export const getOpenclawSchemaStatus = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    try {
      const { fetchOpenclawSchemaStatus } = await import("~/server/openclaw-schema.server")
      return await fetchOpenclawSchemaStatus({ projectId: data.projectId })
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to fetch schema status. Check logs.")
      return { ok: false as const, message } satisfies OpenclawSchemaStatusResult
    }
  })

export type { OpenclawSchemaLiveResult, OpenclawSchemaStatusResult }
