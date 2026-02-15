import { useMutation } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { AsyncButton } from "~/components/ui/async-button"
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
import { SecretInput } from "~/components/ui/secret-input"
import { SettingsSection } from "~/components/ui/settings-section"
import { StackedField } from "~/components/ui/stacked-field"
import { Switch } from "~/components/ui/switch"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import { PROJECT_TOKEN_KEY_LABEL_MAX_CHARS, PROJECT_TOKEN_VALUE_MAX_CHARS } from "~/lib/project-token-keyring"
import { sealForRunner } from "~/lib/security/sealed-input"
import { setupFieldHelp } from "~/lib/setup-field-help"
import type { SetupConfig } from "~/lib/setup/repo-probe"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import { cn } from "~/lib/utils"
import { finalizeDeployCreds, mutateProjectTokenKeyring, updateDeployCreds } from "~/sdk/infra"
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

type SealedRunnerTarget = {
  _id: Id<"runners">
  runnerName: string
  capabilities?: {
    sealedInputPubSpkiB64?: string
    sealedInputKeyId?: string
    sealedInputAlg?: string
  } | null
} | null

export function SetupStepInfrastructure(props: {
  projectId: Id<"projects">
  projectSlug: string
  config: SetupConfig | null
  setupDraft: SetupDraftView | null
  host: string
  hasActiveHcloudToken: boolean
  hasProjectGithubToken: boolean
  targetRunner: SealedRunnerTarget
  stepStatus: SetupStepStatus
  isVisible: boolean
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
  const missingCreds = [
    ...(props.targetRunner ? [] : ["target runner"]),
    ...(props.hasActiveHcloudToken ? [] : ["active Hetzner API key"]),
    ...(props.hasProjectGithubToken ? [] : ["GitHub token"]),
  ]

  const [hcloudLabel, setHcloudLabel] = useState("")
  const [hcloudToken, setHcloudToken] = useState("")
  const [githubToken, setGithubToken] = useState("")

  const addHcloudKey = useMutation({
    mutationFn: async () => {
      if (!props.targetRunner) throw new Error("Select a sealed-capable runner above.")
      const label = hcloudLabel.trim()
      const value = hcloudToken.trim()
      if (!value) throw new Error("Hetzner API key is required")
      if (value.length > PROJECT_TOKEN_VALUE_MAX_CHARS) {
        throw new Error(`Token too long (max ${PROJECT_TOKEN_VALUE_MAX_CHARS} characters)`)
      }
      if (label.length > PROJECT_TOKEN_KEY_LABEL_MAX_CHARS) {
        throw new Error(`Label too long (max ${PROJECT_TOKEN_KEY_LABEL_MAX_CHARS} characters)`)
      }
      return await mutateProjectTokenKeyring({
        data: {
          projectId: props.projectId,
          kind: "hcloud",
          action: "add",
          targetRunnerId: String(props.targetRunner._id) as Id<"runners">,
          label,
          value,
        },
      })
    },
    onSuccess: () => {
      toast.success("Hetzner key queued")
      setHcloudLabel("")
      setHcloudToken("")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const saveGithub = useMutation({
    mutationFn: async () => {
      if (!props.targetRunner) throw new Error("Select a sealed-capable runner above.")
      const value = githubToken.trim()
      if (!value) throw new Error("GitHub token is required")

      const targetRunnerId = String(props.targetRunner._id) as Id<"runners">
      const runnerPub = String(props.targetRunner.capabilities?.sealedInputPubSpkiB64 || "").trim()
      const keyId = String(props.targetRunner.capabilities?.sealedInputKeyId || "").trim()
      const alg = String(props.targetRunner.capabilities?.sealedInputAlg || "").trim()
      if (!runnerPub || !keyId || !alg) throw new Error("Runner sealed-input capabilities incomplete")

      const reserve = await updateDeployCreds({
        data: {
          projectId: props.projectId,
          targetRunnerId,
          updatedKeys: ["GITHUB_TOKEN"],
        },
      }) as any

      const jobId = String(reserve?.jobId || "").trim()
      const kind = String(reserve?.kind || "").trim()
      if (!jobId || !kind) throw new Error("reserve response missing job metadata")

      const reserveRunnerPub = String(reserve?.sealedInputPubSpkiB64 || runnerPub).trim()
      const reserveKeyId = String(reserve?.sealedInputKeyId || keyId).trim()
      const reserveAlg = String(reserve?.sealedInputAlg || alg).trim()
      const aad = `${props.projectId}:${jobId}:${kind}:${targetRunnerId}`
      const sealedInputB64 = await sealForRunner({
        runnerPubSpkiB64: reserveRunnerPub,
        keyId: reserveKeyId,
        alg: reserveAlg,
        aad,
        plaintextJson: JSON.stringify({ GITHUB_TOKEN: value }),
      })

      await finalizeDeployCreds({
        data: {
          projectId: props.projectId,
          jobId,
          kind,
          sealedInputB64,
          sealedInputAlg: reserveAlg,
          sealedInputKeyId: reserveKeyId,
          targetRunnerId,
          updatedKeys: ["GITHUB_TOKEN"],
        },
      })
    },
    onSuccess: () => {
      toast.success("GitHub token queued")
      setGithubToken("")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

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
      <SettingsSection
        title="Project credentials"
        description="Project-wide credentials stored on your runner. Setup reads only runner metadata here (fast)."
        headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
        statusText={missingCreds.length > 0 ? `Missing: ${missingCreds.join(", ")}.` : "Credentials ready."}
      >
        <div className="space-y-4">
          {!props.targetRunner ? (
            <div className="text-xs text-muted-foreground">
              Select a target runner above to manage credentials.
            </div>
          ) : null}

          <div className="space-y-2 rounded-md border bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Hetzner API key</div>
                <div className="text-xs text-muted-foreground">
                  Required for provisioning.
                </div>
              </div>
              <div className={cn("text-xs font-medium", props.hasActiveHcloudToken ? "text-emerald-700" : "text-destructive")}>
                {props.hasActiveHcloudToken ? "Set" : "Missing"}
              </div>
            </div>

            {!props.hasActiveHcloudToken ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <LabelWithHelp htmlFor="setup-hcloud-key-label" help="Optional label for your token.">
                    Label (optional)
                  </LabelWithHelp>
                  <Input
                    id="setup-hcloud-key-label"
                    value={hcloudLabel}
                    placeholder="e.g. laptop"
                    onChange={(event) => setHcloudLabel(event.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <LabelWithHelp htmlFor="setup-hcloud-key-value" help="Hetzner API token used for provisioning (hcloud).">
                    Token
                  </LabelWithHelp>
                  <SecretInput
                    id="setup-hcloud-key-value"
                    value={hcloudToken}
                    onValueChange={setHcloudToken}
                    placeholder="hcloud token"
                  />
                </div>

                <AsyncButton
                  type="button"
                  pending={addHcloudKey.isPending}
                  pendingText="Queuing..."
                  disabled={!props.targetRunner || !hcloudToken.trim()}
                  onClick={() => addHcloudKey.mutate()}
                >
                  Save key
                </AsyncButton>
              </div>
            ) : null}

            <div className="text-xs text-muted-foreground">
              Need multiple keys or change active?{" "}
              <Link
                to="/$projectSlug/security/api-keys"
                params={{ projectSlug: props.projectSlug }}
                className="underline underline-offset-2"
              >
                Manage API keys
              </Link>
            </div>
          </div>

          <div className="space-y-2 rounded-md border bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">GitHub token</div>
                <div className="text-xs text-muted-foreground">
                  Required for repository access during setup apply.
                </div>
              </div>
              <div className={cn("text-xs font-medium", props.hasProjectGithubToken ? "text-emerald-700" : "text-destructive")}>
                {props.hasProjectGithubToken ? "Set" : "Missing"}
              </div>
            </div>

            {!props.hasProjectGithubToken ? (
              <div className="space-y-2">
                <SecretInput
                  id="setup-github-token"
                  value={githubToken}
                  onValueChange={setGithubToken}
                  placeholder="ghp_..."
                />
                <AsyncButton
                  type="button"
                  pending={saveGithub.isPending}
                  pendingText="Queuing..."
                  disabled={!props.targetRunner || !githubToken.trim()}
                  onClick={() => saveGithub.mutate()}
                >
                  Save token
                </AsyncButton>
              </div>
            ) : null}
          </div>
        </div>
      </SettingsSection>

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
    </div>
  )
}
