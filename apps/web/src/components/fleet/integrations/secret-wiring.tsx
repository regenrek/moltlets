import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { suggestSecretNameForEnvVar } from "@clawlets/core/lib/secrets/env-vars"
import { getKnownLlmProviders, getProviderRequiredEnvVars } from "@clawlets/shared/lib/llm-provider-env"
import { SecretNameSchema } from "@clawlets/shared/lib/identifiers"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { Input } from "~/components/ui/input"
import { configDotBatch, configDotSet } from "~/sdk/config"
import { formatIssues, getEnvMapping } from "./helpers"

function isValidEnvVarName(envVar: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(envVar)
}

const SHAREABLE_ENV_VARS = (() => {
  const out = new Set<string>()
  for (const provider of getKnownLlmProviders()) {
    for (const envVar of getProviderRequiredEnvVars(provider)) out.add(envVar)
  }
  return out
})()

function isShareableEnvVar(envVar: string): boolean {
  return SHAREABLE_ENV_VARS.has(envVar)
}

export function SecretWiringDetails(props: {
  projectId: string
  gatewayId: string
  host: string
  canEdit: boolean
  envVars: string[]
  fleetSecretEnv: unknown
  gatewaySecretEnv: unknown
}) {
  const [draftSecretByEnvVar, setDraftSecretByEnvVar] = useState<Record<string, string>>({})

  const wireEnv = useMutation({
    mutationFn: async (params: { envVar: string; scope: "gateway" | "fleet"; secretName: string }) => {
      const envVar = params.envVar.trim()
      const secretName = params.secretName.trim()
      if (!envVar) throw new Error("missing env var")
      if (!secretName) throw new Error("missing secret name")
      if (!isValidEnvVarName(envVar)) throw new Error(`invalid env var: ${envVar}`)
      const parsed = SecretNameSchema.safeParse(secretName)
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "invalid secret name")

      const path =
        params.scope === "gateway"
          ? `hosts.${props.host}.gateways.${props.gatewayId}.profile.secretEnv.${envVar}`
          : `fleet.secretEnv.${envVar}`

      const res = await configDotSet({
        data: {
          projectId: props.projectId as Id<"projects">,
          path,
          value: secretName,
          del: false,
        },
      })
      if (!res.ok) throw new Error(formatIssues(res.issues))
      return { ok: true as const }
    },
    onSuccess: (_res, vars) => {
      toast.success("Secret wiring updated")
      setDraftSecretByEnvVar((prev) => {
        const next = { ...prev }
        delete next[vars.envVar]
        return next
      })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const promoteToFleet = useMutation({
    mutationFn: async (params: { envVar: string; secretName: string }) => {
      const envVar = params.envVar.trim()
      const secretName = params.secretName.trim()
      if (!envVar) throw new Error("missing env var")
      if (!secretName) throw new Error("missing secret name")
      if (!isValidEnvVarName(envVar)) throw new Error(`invalid env var: ${envVar}`)
      const parsed = SecretNameSchema.safeParse(secretName)
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "invalid secret name")

      const ops: Array<{ path: string; value?: string; valueJson?: string; del: boolean }> = [
        { path: `fleet.secretEnv.${envVar}`, value: secretName, del: false },
      ]

      const gatewayKey =
        props.gatewaySecretEnv && typeof props.gatewaySecretEnv === "object"
          ? (props.gatewaySecretEnv as any)[envVar]
          : undefined
      if (typeof gatewayKey === "string") {
        ops.push({ path: `hosts.${props.host}.gateways.${props.gatewayId}.profile.secretEnv.${envVar}`, del: true })
      }

      const res = await configDotBatch({ data: { projectId: props.projectId as Id<"projects">, ops } })
      if (!res.ok) throw new Error(formatIssues(res.issues))
      return { ok: true as const }
    },
    onSuccess: () => {
      toast.success("Promoted to fleet")
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  return (
    <details className="rounded-lg border bg-card p-4">
      <summary className="cursor-pointer select-none text-sm font-medium">
        Secret wiring (advanced)
        <span className="ml-2 text-xs font-normal text-muted-foreground">({props.envVars.length} env vars referenced)</span>
      </summary>

      <div className="mt-4 space-y-3">
        {props.envVars.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No <code>${"{ENV}"}</code> refs found in this gateway’s OpenClaw config.
          </div>
        ) : (
          <div className="space-y-2">
            {props.envVars.map((envVar) => {
              const mapping = getEnvMapping({
                envVar,
                fleetSecretEnv: props.fleetSecretEnv,
                gatewaySecretEnv: props.gatewaySecretEnv,
              })

              const suggested = suggestSecretNameForEnvVar(envVar, props.gatewayId)
              const rawDraft = draftSecretByEnvVar[envVar] ?? suggested
              const draft = rawDraft.trim()

              const hasMapping = Boolean(mapping?.secretName)
              const canPromote = Boolean(mapping && mapping.scope === "gateway" && isShareableEnvVar(envVar))

              return (
                <div key={envVar} className="rounded-md border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        <code>{envVar}</code>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                        {hasMapping ? (
                          <>
                            mapped to <code>{mapping!.secretName}</code> (
                            {mapping!.scope === "gateway" ? "gateway" : "fleet"})
                          </>
                        ) : (
                          <>missing mapping</>
                        )}
                        {canPromote ? (
                          <AsyncButton
                            size="sm"
                            variant="outline"
                            disabled={!props.canEdit || promoteToFleet.isPending}
                            pending={promoteToFleet.isPending}
                            pendingText="Promoting..."
                            onClick={() => promoteToFleet.mutate({ envVar, secretName: mapping!.secretName })}
                          >
                            Promote to fleet
                          </AsyncButton>
                        ) : null}
                      </div>
                    </div>
                    {hasMapping ? <Badge variant="secondary">ok</Badge> : <Badge variant="destructive">missing</Badge>}
                  </div>

                  {!hasMapping ? (
                    <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] items-end">
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground">Secret name</div>
                        <Input
                          value={rawDraft}
                          onChange={(e) => setDraftSecretByEnvVar((prev) => ({ ...prev, [envVar]: e.target.value }))}
                          disabled={!props.canEdit}
                        />
                      </div>
                      <AsyncButton
                        size="sm"
                        variant="outline"
                        disabled={!props.canEdit || wireEnv.isPending || !draft || !isValidEnvVarName(envVar)}
                        pending={wireEnv.isPending}
                        pendingText="Mapping..."
                        onClick={() => wireEnv.mutate({ envVar, scope: "fleet", secretName: draft })}
                      >
                        Map (fleet)
                      </AsyncButton>
                      <AsyncButton
                        size="sm"
                        variant="outline"
                        disabled={!props.canEdit || wireEnv.isPending || !draft || !isValidEnvVarName(envVar)}
                        pending={wireEnv.isPending}
                        pendingText="Mapping..."
                        onClick={() => wireEnv.mutate({ envVar, scope: "gateway", secretName: draft })}
                      >
                        Map (gateway)
                      </AsyncButton>
                      {!isValidEnvVarName(envVar) ? (
                        <div className="md:col-span-3 text-xs text-muted-foreground">
                          Invalid env var name (expected <code>[A-Z_][A-Z0-9_]*</code>).
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </details>
  )
}
