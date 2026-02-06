import { createServerFn } from "@tanstack/react-start"
import { ClawletsConfigSchema } from "@clawlets/core/lib/config/clawlets-config"
import type { ValidationIssue } from "~/sdk/run-with-events"

export type { ClawletsConfig, SshExposureMode, TailnetMode } from "@clawlets/core/lib/config/clawlets-config"
export { GatewayIdSchema, HostNameSchema } from "@clawlets/shared/lib/identifiers"

export const validateClawletsConfig = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): unknown => data)
  .handler(async ({ data }) => {
    const parsed = ClawletsConfigSchema.safeParse(data)

    if (parsed.success) {
      return { ok: true as const }
    }

    return {
      ok: false as const,
      issues: (parsed.error.issues as unknown[]).map((issue) => {
        const i = issue as { code?: unknown; path?: unknown; message?: unknown }
        return {
          code: String(i.code ?? "invalid"),
          path: Array.isArray(i.path) ? (i.path as Array<string | number>) : [],
          message: String(i.message ?? "Invalid config"),
        } satisfies ValidationIssue
      }),
    }
  })
