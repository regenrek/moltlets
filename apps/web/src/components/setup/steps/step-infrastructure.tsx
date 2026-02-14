import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import {
  deriveDeployReadiness,
  deriveFirstPushGuidance,
} from "~/components/deploy/deploy-setup-model"
import { ProjectTokenKeyringCard } from "~/components/setup/project-token-keyring-card"
import {
  HETZNER_LOCATION_OPTIONS,
  HETZNER_SERVER_TYPE_OPTIONS,
  HETZNER_SETUP_DEFAULT_LOCATION,
  HETZNER_SETUP_DEFAULT_SERVER_TYPE,
  isKnownHetznerLocation,
  isKnownHetznerServerType,
} from "~/components/hosts/hetzner-options"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { SettingsSection } from "~/components/ui/settings-section"
import { StackedField } from "~/components/ui/stacked-field"
import { Switch } from "~/components/ui/switch"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import type { SetupConfig } from "~/lib/setup/repo-probe"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import { cn } from "~/lib/utils"
import { gitRepoStatus } from "~/sdk/vcs"
import type { SetupDraftInfrastructure, SetupDraftView } from "~/sdk/setup"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.trunc(value))
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim()
  if (!/^[0-9]+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

function resolveServerTypePreset(value: string): string {
  return isKnownHetznerServerType(value) ? value : HETZNER_SETUP_DEFAULT_SERVER_TYPE
}

function resolveLocationPreset(value: string): string {
  return isKnownHetznerLocation(value) ? value : HETZNER_SETUP_DEFAULT_LOCATION
}

function resolveHostDefaults(config: SetupConfig | null, host: string, setupDraft: SetupDraftView | null) {
  const hostCfg = asRecord(config?.hosts?.[host]) ?? {}
  const hetznerCfg = asRecord(hostCfg.hetzner) ?? {}
  const draft = setupDraft?.nonSecretDraft?.infrastructure ?? null
  const serverType = resolveServerTypePreset(asString(draft?.serverType, asString(hetznerCfg.serverType, HETZNER_SETUP_DEFAULT_SERVER_TYPE)).trim())
  const location = resolveLocationPreset(asString(draft?.location, asString(hetznerCfg.location, HETZNER_SETUP_DEFAULT_LOCATION)).trim())
  const configuredVolumeSizeGb = asNonNegativeInt(hetznerCfg.volumeSizeGb, 0)
  const draftVolumeEnabled = typeof draft?.volumeEnabled === "boolean" ? draft.volumeEnabled : undefined
  const draftVolumeSizeGb = asNonNegativeInt(draft?.volumeSizeGb, configuredVolumeSizeGb)
  const volumeEnabled = draftVolumeEnabled ?? configuredVolumeSizeGb > 0
  const volumeSizeGb = Math.max(1, draftVolumeSizeGb > 0 ? draftVolumeSizeGb : 50)

  return {
    serverType,
    image: asString(draft?.image, asString(hetznerCfg.image, "")),
    location,
    volumeEnabled,
    volumeSizeGb,
  }
}

export function SetupStepInfrastructure(props: {
  projectId: Id<"projects">
  config: SetupConfig | null
  setupDraft: SetupDraftView | null
  host: string
  hasActiveHcloudToken: boolean
  stepStatus: SetupStepStatus
  onDraftChange: (next: SetupDraftInfrastructure) => void
}) {
  const defaults = resolveHostDefaults(props.config, props.host, props.setupDraft)
  const [serverType, setServerType] = useState(() => defaults.serverType)
  const [image, setImage] = useState(() => defaults.image)
  const [location, setLocation] = useState(() => defaults.location)
  const [volumeEnabled, setVolumeEnabled] = useState(() => defaults.volumeEnabled)
  const [volumeSizeGbText, setVolumeSizeGbText] = useState(() => String(defaults.volumeSizeGb))
  const parsedVolumeSizeGb = parsePositiveInt(volumeSizeGbText)
  const volumeSettingsReady = !volumeEnabled || parsedVolumeSizeGb !== null
  const hcloudTokenReady = props.hasActiveHcloudToken
  const serverTypeTrimmed = serverType.trim()
  const locationTrimmed = location.trim()
  const resolvedServerType = resolveServerTypePreset(serverTypeTrimmed)
  const resolvedLocation = resolveLocationPreset(locationTrimmed)
  const missingRequirements = [
    ...(hcloudTokenReady ? [] : ["active Hetzner API key"]),
    ...(resolvedServerType.length > 0 ? [] : ["hetzner.serverType"]),
    ...(resolvedLocation.length > 0 ? [] : ["hetzner.location"]),
    ...(!volumeSettingsReady ? ["hetzner.volumeSizeGb"] : []),
  ]
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId: props.projectId }),
  })
  const runnerOnline = useMemo(
    () => isProjectRunnerOnline(runnersQuery.data ?? []),
    [runnersQuery.data],
  )
  const repoStatus = useQuery({
    queryKey: ["gitRepoStatus", props.projectId],
    queryFn: async () => await gitRepoStatus({ data: { projectId: props.projectId } }),
    enabled: runnerOnline,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const githubReadiness = deriveDeployReadiness({
    runnerOnline,
    repoPending: repoStatus.isPending,
    repoError: repoStatus.error,
    missingRev: !repoStatus.data?.originHead,
    needsPush: Boolean(repoStatus.data?.needsPush),
    localSelected: false,
    allowLocalDeploy: false,
  })
  const firstPushGuidance = deriveFirstPushGuidance({ upstream: repoStatus.data?.upstream })

  useEffect(() => {
    props.onDraftChange({
      serverType: resolvedServerType,
      image: image.trim(),
      location: resolvedLocation,
      volumeEnabled,
      volumeSizeGb: volumeEnabled ? parsedVolumeSizeGb ?? undefined : 0,
    })
  }, [
    image,
    parsedVolumeSizeGb,
    props.onDraftChange,
    resolvedLocation,
    resolvedServerType,
    volumeEnabled,
  ])

  return (
    <div className="space-y-4">
      <ProjectTokenKeyringCard
        projectId={props.projectId}
        kind="hcloud"
        title="Hetzner API keys"
        description={(
          <>
            Project-wide Hetzner tokens. Add multiple keys, then select the active key used for provisioning.
          </>
        )}
        headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
        showRunnerStatusBanner={false}
        showRunnerStatusDetails={false}
      />

      <SettingsSection
        title="Hetzner host configuration"
        description="Set provisioning defaults. Values are committed during final deploy."
        statusText={missingRequirements.length > 0 ? `Missing: ${missingRequirements.join(", ")}.` : "Ready for final deploy check."}
      >
        <div className="space-y-4">
          <StackedField
            id="setup-hetzner-server-type"
            label="Server type"
            help={setupFieldHelp.hosts.hetznerServerType}
          >
            <RadioGroup
              value={resolvedServerType}
              onValueChange={setServerType}
              className="gap-3"
            >
              {HETZNER_SERVER_TYPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex items-start gap-3 rounded-md border bg-muted/10 p-3",
                    resolvedServerType === option.value && "border-primary bg-muted/20",
                  )}
                >
                  <RadioGroupItem value={option.value} id={`setup-hetzner-server-type-${option.value}`} />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="block text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </StackedField>

          <StackedField
            id="setup-hetzner-location"
            label="Location"
            help={setupFieldHelp.hosts.hetznerLocation}
          >
            <RadioGroup
              value={resolvedLocation}
              onValueChange={setLocation}
              className="grid gap-3 md:grid-cols-2"
            >
              {HETZNER_LOCATION_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex items-start gap-3 rounded-md border bg-muted/10 p-3",
                    resolvedLocation === option.value && "border-primary bg-muted/20",
                  )}
                >
                  <RadioGroupItem value={option.value} id={`setup-hetzner-location-${option.value}`} />
                  <span className="inline-flex h-6 w-8 shrink-0 overflow-hidden rounded-sm">
                    <option.flag className="h-6 w-8" />
                  </span>
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {option.description} ({option.value})
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </StackedField>

          <div className="space-y-2 rounded-md border bg-muted/10 p-3">
            <LabelWithHelp htmlFor="setup-hetzner-volume-enabled" help={setupFieldHelp.hosts.hetznerVolumeEnabled}>
              Persistent state volume
            </LabelWithHelp>
            <div className="mt-1 flex items-center gap-3">
              <Switch
                id="setup-hetzner-volume-enabled"
                checked={volumeEnabled}
                onCheckedChange={setVolumeEnabled}
              />
              <span className="text-sm text-muted-foreground">
                Mount a dedicated Hetzner volume at <code>/srv/openclaw</code>.
              </span>
            </div>
            {volumeEnabled ? (
              <StackedField
                id="setup-hetzner-volume-size-gb"
                label="Volume size (GB)"
                help={setupFieldHelp.hosts.hetznerVolumeSizeGb}
              >
                <Input
                  id="setup-hetzner-volume-size-gb"
                  inputMode="numeric"
                  value={volumeSizeGbText}
                  placeholder="50"
                  onChange={(event) => setVolumeSizeGbText(event.target.value)}
                />
                <div className="text-xs text-muted-foreground">
                  Recommended minimum: 50 GB.
                </div>
              </StackedField>
            ) : (
              <div className="text-xs text-muted-foreground">
                Disabled: memory/session data remains on the root disk unless backups are configured.
              </div>
            )}
          </div>

          <Accordion className="rounded-lg border bg-muted/20">
            <AccordionItem value="advanced" className="px-4">
              <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
                Advanced options
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="space-y-4">
                  <StackedField
                    id="setup-hetzner-image"
                    label="Image"
                    help={setupFieldHelp.hosts.hetznerImage}
                    description='Default: empty (uses NixOS path)'
                  >
                    <Input
                      id="setup-hetzner-image"
                      value={image}
                      placeholder="leave empty for default"
                      onChange={(event) => setImage(event.target.value)}
                    />
                  </StackedField>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </SettingsSection>

      <DeployCredsCard
        projectId={props.projectId}
        visibleKeys={["GITHUB_TOKEN"]}
        setupDraftFlow={{
          host: props.host,
          setupDraft: props.setupDraft,
        }}
        title="GitHub access"
        description="GitHub token used for repository access during setup apply."
        githubReadiness={{
          runnerOnline,
          pending: repoStatus.isPending,
          refreshing: repoStatus.isFetching,
          originHead: repoStatus.data?.originHead,
          branch: repoStatus.data?.branch,
          upstream: repoStatus.data?.upstream,
          ahead: repoStatus.data?.ahead,
          behind: repoStatus.data?.behind,
          onRefresh: () => {
            if (!runnerOnline) return
            void repoStatus.refetch()
          },
          alert: githubReadiness.reason !== "ready" && githubReadiness.reason !== "repo_pending"
            ? {
                severity: githubReadiness.severity,
                message: githubReadiness.message,
                title: githubReadiness.title,
                detail: githubReadiness.detail,
              }
            : null,
        }}
        githubFirstPushGuidance={githubReadiness.showFirstPushGuidance
          ? {
              commands: firstPushGuidance.commands,
              hasUpstream: firstPushGuidance.hasUpstream,
              upstream: repoStatus.data?.upstream,
            }
          : null}
      />
    </div>
  )
}
