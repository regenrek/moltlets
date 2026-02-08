import { useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { findEnvVarRefs } from "@clawlets/core/lib/secrets/env-var-refs"
import { listPinnedChannelUiModels } from "@clawlets/core/lib/openclaw/channel-ui-metadata"
import { SecretNameSchema, SkillIdSchema } from "@clawlets/shared/lib/identifiers"
import { ChannelsRuntimeCard } from "./cards/channels-runtime-card"
import { ChannelsConfigCard } from "./cards/channels-card"
import { buildGatewayConfigPath } from "./shared/config-path"
import { HooksConfigCard } from "./cards/hooks-card"
import { PluginsConfigCard } from "./cards/plugins-card"
import { SecretWiringDetails } from "./secret-wiring"
import { SkillsConfigCard } from "./cards/skills-card"
import { formatIssues, isPlainObject, listEnabledChannels, readInlineSecretWarnings } from "./helpers"
import { configDotBatch, configDotSet } from "~/sdk/config"

export function GatewayIntegrations(props: {
  projectId: string
  gatewayId: string
  host: string
  channels: unknown
  agents: unknown
  hooks: unknown
  skills: unknown
  plugins: unknown
  openclaw: unknown
  profile: unknown
  fleetSecretEnv: unknown
  canEdit: boolean
  configQueryKey?: readonly unknown[]
  metadataQueryKey?: readonly unknown[]
}) {
  const queryClient = useQueryClient()

  const refreshQueries = async () => {
    if (props.configQueryKey) await queryClient.invalidateQueries({ queryKey: props.configQueryKey })
    if (props.metadataQueryKey) await queryClient.invalidateQueries({ queryKey: props.metadataQueryKey })
  }

  const effectiveConfigForAnalysis = useMemo(() => {
    // For analysis (env refs + token warnings), treat first-class fields as part of the effective OpenClaw config.
    const base = isPlainObject(props.openclaw) ? { ...(props.openclaw as any) } : {}
    if (isPlainObject(props.channels)) base.channels = props.channels
    if (isPlainObject(props.agents)) base.agents = props.agents
    if (isPlainObject(props.hooks)) base.hooks = props.hooks
    if (isPlainObject(props.skills)) base.skills = props.skills
    if (isPlainObject(props.plugins)) base.plugins = props.plugins
    return base
  }, [props.openclaw, props.channels, props.agents, props.hooks, props.skills, props.plugins])

  const envRefs = useMemo(() => findEnvVarRefs(effectiveConfigForAnalysis), [effectiveConfigForAnalysis])
  const enabledChannels = useMemo(() => listEnabledChannels(effectiveConfigForAnalysis), [effectiveConfigForAnalysis])
  const tokenWarnings = useMemo(() => readInlineSecretWarnings(effectiveConfigForAnalysis), [effectiveConfigForAnalysis])
  const channelModels = useMemo(() => listPinnedChannelUiModels(), [])
  const channelModelById = useMemo(
    () => new Map(channelModels.map((channel) => [channel.id, channel] as const)),
    [channelModels],
  )

  const gatewaySecretEnv = (props.profile as any)?.secretEnv

  const channelsObj = isPlainObject(props.channels) ? (props.channels as Record<string, unknown>) : {}
  const allowFromKey = channelModels
    .filter((channel) => channel.allowFrom)
    .map((channel) => {
      const entry = channelsObj[channel.id]
      const allowFrom = isPlainObject(entry) ? entry["allowFrom"] : undefined
      const text = Array.isArray(allowFrom) ? allowFrom.map(String).join("\n") : ""
      return `${channel.id}:${text}`
    })
    .sort()
    .join("|")
  const channelsKey = `${props.gatewayId}:${allowFromKey}`

  const hooksObj = isPlainObject(props.hooks) ? (props.hooks as Record<string, unknown>) : {}
  const skillsObj = isPlainObject(props.skills) ? (props.skills as Record<string, unknown>) : {}
  const pluginsObj = isPlainObject(props.plugins) ? (props.plugins as Record<string, unknown>) : {}

  const hooksTokenSecret = typeof hooksObj["tokenSecret"] === "string" ? String(hooksObj["tokenSecret"]) : ""
  const hooksGmailPushTokenSecret =
    typeof hooksObj["gmailPushTokenSecret"] === "string" ? String(hooksObj["gmailPushTokenSecret"]) : ""
  const hooksKey = `${props.gatewayId}:${hooksTokenSecret}:${hooksGmailPushTokenSecret}`

  const allowBundled = Array.isArray(skillsObj["allowBundled"]) ? (skillsObj["allowBundled"] as unknown[]) : []
  const skillsLoad = isPlainObject(skillsObj["load"]) ? (skillsObj["load"] as Record<string, unknown>) : {}
  const skillsExtraDirs = Array.isArray(skillsLoad["extraDirs"]) ? (skillsLoad["extraDirs"] as unknown[]) : []

  const pluginsAllow = Array.isArray(pluginsObj["allow"]) ? (pluginsObj["allow"] as unknown[]) : []
  const pluginsDeny = Array.isArray(pluginsObj["deny"]) ? (pluginsObj["deny"] as unknown[]) : []
  const pluginsLoad = isPlainObject(pluginsObj["load"]) ? (pluginsObj["load"] as Record<string, unknown>) : {}
  const pluginsPaths = Array.isArray(pluginsLoad["paths"]) ? (pluginsLoad["paths"] as unknown[]) : []

  const allowBundledDefault = allowBundled.map(String).join("\n")
  const extraDirsDefault = skillsExtraDirs.map(String).join("\n")
  const pluginsAllowDefault = pluginsAllow.map(String).join("\n")
  const pluginsDenyDefault = pluginsDeny.map(String).join("\n")
  const pluginsPathsDefault = pluginsPaths.map(String).join("\n")
  const pluginsKey = `${props.gatewayId}:${pluginsAllowDefault}:${pluginsDenyDefault}:${pluginsPathsDefault}`

  const writeChannels = useMutation({
    mutationFn: async (params: { channelId: string; enabled?: boolean; allowFrom?: string[] }) => {
      const channel = channelModelById.get(params.channelId)
      if (!channel) throw new Error(`Unknown channel: ${params.channelId}`)
      if (params.enabled !== undefined && !channel.supportsEnabled) {
        throw new Error(`${channel.name} does not expose an enabled toggle in the schema.`)
      }
      if (params.allowFrom !== undefined && !channel.allowFrom) {
        throw new Error(`${channel.name} allowFrom is not supported; use channel-specific options instead.`)
      }

      const ops: Array<{ path: string; value?: string; valueJson?: string; del: boolean }> = []

      if (params.enabled !== undefined) {
        ops.push({
          path: buildGatewayConfigPath(props.host, props.gatewayId, "channels", params.channelId, "enabled"),
          valueJson: JSON.stringify(params.enabled),
          del: false,
        })
      }

      if (params.allowFrom !== undefined) {
        ops.push({
          path: buildGatewayConfigPath(props.host, props.gatewayId, "channels", params.channelId, "allowFrom"),
          valueJson: JSON.stringify(params.allowFrom),
          del: false,
        })
      }

      if (ops.length === 0) return { ok: true as const }
      const res = await configDotBatch({ data: { projectId: props.projectId as Id<"projects">, ops } })
      if (!res.ok) throw new Error(formatIssues(res.issues))
      return { ok: true as const }
    },
    onSuccess: async () => {
      toast.success("Channel config updated")
      await refreshQueries()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const writeConfig = useMutation({
    mutationFn: async (params: {
      path: string
      value?: string
      valueJson?: string
      del?: boolean
      successMessage?: string
    }) => {
      const data: Record<string, unknown> = {
        projectId: props.projectId as Id<"projects">,
        path: params.path,
        del: Boolean(params.del),
      }
      if (params.valueJson !== undefined) data.valueJson = params.valueJson
      if (params.value !== undefined) data.value = params.value
      const res = await configDotSet({ data })
      if (!res.ok) throw new Error(formatIssues(res.issues))
      return params.successMessage ?? "Config updated"
    },
    onSuccess: async (message) => {
      toast.success(message)
      await refreshQueries()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const writeSkillEntry = useMutation({
    mutationFn: async (params: { skill: string; apiKeySecret: string; clearInline?: boolean }) => {
      const skill = params.skill.trim()
      const secret = params.apiKeySecret.trim()
      if (!skill) throw new Error("Missing skill id")
      if (!secret) throw new Error("Missing apiKeySecret")
      const parsedSkill = SkillIdSchema.safeParse(skill)
      if (!parsedSkill.success) throw new Error(parsedSkill.error.issues[0]?.message || "Invalid skill id")
      const parsedSecret = SecretNameSchema.safeParse(secret)
      if (!parsedSecret.success) throw new Error(parsedSecret.error.issues[0]?.message || "Invalid secret name")

      const ops: Array<{ path: string; value?: string; valueJson?: string; del: boolean }> = [
        {
          path: buildGatewayConfigPath(props.host, props.gatewayId, "skills", "entries", parsedSkill.data, "apiKeySecret"),
          value: secret,
          del: false,
        },
      ]
      if (params.clearInline) {
        ops.push({
          path: buildGatewayConfigPath(props.host, props.gatewayId, "skills", "entries", parsedSkill.data, "apiKey"),
          del: true,
        })
      }
      const res = await configDotBatch({ data: { projectId: props.projectId as Id<"projects">, ops } })
      if (!res.ok) throw new Error(formatIssues(res.issues))
      return "Skill secret updated"
    },
    onSuccess: async (message) => {
      toast.success(message)
      await refreshQueries()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  return (
    <div className="space-y-4">
      <ChannelsRuntimeCard
        projectId={props.projectId}
        gatewayId={props.gatewayId}
        host={props.host}
        canEdit={props.canEdit}
        channelModels={channelModels}
        enabledChannels={enabledChannels}
      />

      <ChannelsConfigCard
        key={channelsKey}
        host={props.host}
        gatewayId={props.gatewayId}
        channels={props.channels}
        channelModels={channelModels}
        canEdit={props.canEdit}
        pending={writeChannels.isPending}
        onToggleChannel={({ channelId, enabled }) => writeChannels.mutate({ channelId, enabled })}
        onSaveAllowFrom={({ channelId, allowFrom }) => writeChannels.mutate({ channelId, allowFrom })}
      />

      <HooksConfigCard
        key={hooksKey}
        host={props.host}
        gatewayId={props.gatewayId}
        hooks={props.hooks}
        canEdit={props.canEdit}
        pending={writeConfig.isPending}
        initialTokenSecret={hooksTokenSecret}
        initialGmailPushTokenSecret={hooksGmailPushTokenSecret}
        onToggleEnabled={(enabled) =>
          writeConfig.mutate({
            path: buildGatewayConfigPath(props.host, props.gatewayId, "hooks", "enabled"),
            valueJson: JSON.stringify(enabled),
            del: false,
            successMessage: "Hooks updated",
          })
        }
        onSaveTokenSecret={(raw) => {
          const value = raw.trim()
          writeConfig.mutate({
            path: buildGatewayConfigPath(props.host, props.gatewayId, "hooks", "tokenSecret"),
            value: value || undefined,
            del: !value,
            successMessage: "Hooks updated",
          })
        }}
        onSaveGmailPushTokenSecret={(raw) => {
          const value = raw.trim()
          writeConfig.mutate({
            path: buildGatewayConfigPath(props.host, props.gatewayId, "hooks", "gmailPushTokenSecret"),
            value: value || undefined,
            del: !value,
            successMessage: "Hooks updated",
          })
        }}
      />

      <SkillsConfigCard
        host={props.host}
        gatewayId={props.gatewayId}
        skills={props.skills}
        canEdit={props.canEdit}
        pending={writeConfig.isPending}
        skillEntryPending={writeSkillEntry.isPending}
        initialAllowBundledText={allowBundledDefault}
        initialExtraDirsText={extraDirsDefault}
        onSaveAllowBundled={(allowBundled) =>
          writeConfig.mutate({
            path: buildGatewayConfigPath(props.host, props.gatewayId, "skills", "allowBundled"),
            valueJson: JSON.stringify(allowBundled),
            del: false,
            successMessage: "Skills updated",
          })
        }
        onSaveExtraDirs={(extraDirs) =>
          writeConfig.mutate({
            path: buildGatewayConfigPath(props.host, props.gatewayId, "skills", "load", "extraDirs"),
            valueJson: JSON.stringify(extraDirs),
            del: false,
            successMessage: "Skills updated",
          })
        }
        onSaveSkillSecret={(params) => writeSkillEntry.mutateAsync(params)}
        onRemoveSkillEntry={(skill) => {
          const parsed = SkillIdSchema.safeParse(skill)
          if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || "Invalid skill id")
            return
          }
          writeConfig.mutate({
            path: buildGatewayConfigPath(props.host, props.gatewayId, "skills", "entries", parsed.data),
            del: true,
            successMessage: "Skill entry removed",
          })
        }}
      />

      <PluginsConfigCard
        key={pluginsKey}
        host={props.host}
        gatewayId={props.gatewayId}
        plugins={props.plugins}
        canEdit={props.canEdit}
        pending={writeConfig.isPending}
        initialAllowText={pluginsAllowDefault}
        initialDenyText={pluginsDenyDefault}
        initialPathsText={pluginsPathsDefault}
        onToggleEnabled={(enabled) =>
          writeConfig.mutate({
            path: buildGatewayConfigPath(props.host, props.gatewayId, "plugins", "enabled"),
            valueJson: JSON.stringify(enabled),
            del: false,
            successMessage: "Plugins updated",
          })
        }
        onSaveAllow={(allow) =>
          writeConfig.mutate({
            path: buildGatewayConfigPath(props.host, props.gatewayId, "plugins", "allow"),
            valueJson: JSON.stringify(allow),
            del: false,
            successMessage: "Plugins updated",
          })
        }
        onSaveDeny={(deny) =>
          writeConfig.mutate({
            path: buildGatewayConfigPath(props.host, props.gatewayId, "plugins", "deny"),
            valueJson: JSON.stringify(deny),
            del: false,
            successMessage: "Plugins updated",
          })
        }
        onSavePaths={(paths) =>
          writeConfig.mutate({
            path: buildGatewayConfigPath(props.host, props.gatewayId, "plugins", "load", "paths"),
            valueJson: JSON.stringify(paths),
            del: false,
            successMessage: "Plugins updated",
          })
        }
      />

      {tokenWarnings.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
          <div className="font-medium">Inline secret warnings</div>
          <ul className="list-disc pl-5 text-muted-foreground">
            {tokenWarnings.slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <SecretWiringDetails
        projectId={props.projectId}
        gatewayId={props.gatewayId}
        host={props.host}
        canEdit={props.canEdit}
        envVars={envRefs.vars}
        fleetSecretEnv={props.fleetSecretEnv}
        gatewaySecretEnv={gatewaySecretEnv}
      />
    </div>
  )
}
