import { createServerFn } from "@tanstack/react-start"

export type { ClawletsConfig } from "@clawlets/core/lib/clawlets-config"
export type { SshExposureMode, TailnetMode } from "@clawlets/core/lib/clawlets-config"
export { GatewayIdSchema, HostNameSchema } from "@clawlets/shared/lib/identifiers"

export type ValidationIssue = {
  code: string
  path: Array<string | number>
  message: string
}

export const validateClawletsConfig = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): unknown => data)
  .handler(async ({ data }) => {
    const { ClawletsConfigSchema } = await import(
      "@clawlets/core/lib/clawlets-config"
    )
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
