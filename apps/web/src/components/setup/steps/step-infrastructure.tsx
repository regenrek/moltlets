import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import {
  HETZNER_LOCATION_OPTIONS,
  HETZNER_RADIO_CUSTOM_VALUE,
  HETZNER_SERVER_TYPE_OPTIONS,
  HETZNER_SETUP_DEFAULT_LOCATION,
  HETZNER_SETUP_DEFAULT_SERVER_TYPE,
  isKnownHetznerLocation,
  isKnownHetznerServerType,
} from "~/components/hosts/hetzner-options"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { AsyncButton } from "~/components/ui/async-button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { SettingsSection } from "~/components/ui/settings-section"
import { StackedField } from "~/components/ui/stacked-field"
import { Switch } from "~/components/ui/switch"
import { setupFieldHelp } from "~/lib/setup-field-help"
import type { SetupConfig } from "~/lib/setup/repo-probe"
import { cn } from "~/lib/utils"
import { setupDraftSaveNonSecret, type SetupDraftView } from "~/sdk/setup"
import type { DeployCredsStatus } from "~/sdk/infra"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import type { SetupStepStatus } from "~/lib/setup/setup-model"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function resolveHostDefaults(config: SetupConfig | null, host: string, setupDraft: SetupDraftView | null) {
  const hostCfg = asRecord(config?.hosts?.[host]) ?? {}
  const hetznerCfg = asRecord(hostCfg.hetzner) ?? {}
  const draft = setupDraft?.nonSecretDraft?.infrastructure ?? null
  return {
    serverType: asString(draft?.serverType, asString(hetznerCfg.serverType, HETZNER_SETUP_DEFAULT_SERVER_TYPE)),
    image: asString(draft?.image, asString(hetznerCfg.image, "")),
    location: asString(draft?.location, asString(hetznerCfg.location, HETZNER_SETUP_DEFAULT_LOCATION)),
    allowTailscaleUdpIngress: asBoolean(draft?.allowTailscaleUdpIngress, asBoolean(hetznerCfg.allowTailscaleUdpIngress, true)),
  }
}

function readHcloudTokenState(setupDraft: SetupDraftView | null, deployCreds: DeployCredsStatus | null): "set" | "unset" {
  const row = deployCreds?.keys.find((entry) => entry.key === "HCLOUD_TOKEN")
  if (row?.status === "set") return "set"
  if (setupDraft?.sealedSecretDrafts?.deployCreds?.status === "set") return "set"
  return "unset"
}

export function SetupStepInfrastructure(props: {
  projectId: Id<"projects">
  config: SetupConfig | null
  setupDraft: SetupDraftView | null
  deployCreds: DeployCredsStatus | null
  host: string
  stepStatus: SetupStepStatus
}) {
  const queryClient = useQueryClient()
  const defaults = resolveHostDefaults(props.config, props.host, props.setupDraft)
  const [serverType, setServerType] = useState(() => defaults.serverType)
  const [image, setImage] = useState(() => defaults.image)
  const [location, setLocation] = useState(() => defaults.location)
  const [allowTailscaleUdpIngress, setAllowTailscaleUdpIngress] = useState(() => defaults.allowTailscaleUdpIngress)
  const hcloudTokenState = readHcloudTokenState(props.setupDraft, props.deployCreds)
  const hcloudTokenReady = hcloudTokenState === "set"
  const hostConfigReady = serverType.trim().length > 0 && location.trim().length > 0
  const missingRequirements = [
    ...(hcloudTokenReady ? [] : ["HCLOUD_TOKEN"]),
    ...(serverType.trim().length > 0 ? [] : ["hetzner.serverType"]),
    ...(location.trim().length > 0 ? [] : ["hetzner.location"]),
  ]
  const serverTypeTrimmed = serverType.trim()
  const locationTrimmed = location.trim()
  const serverTypeKnown = isKnownHetznerServerType(serverTypeTrimmed)
  const locationKnown = isKnownHetznerLocation(locationTrimmed)
  const serverTypeRadioValue = serverTypeKnown ? serverTypeTrimmed : HETZNER_RADIO_CUSTOM_VALUE
  const locationRadioValue = locationKnown ? locationTrimmed : HETZNER_RADIO_CUSTOM_VALUE

  const saveHostSettings = useMutation({
    mutationFn: async () => {
      if (!props.host.trim()) throw new Error("missing host")
      if (!hostConfigReady) throw new Error("Set server type and location first.")
      return await setupDraftSaveNonSecret({
        data: {
          projectId: props.projectId,
          host: props.host,
          expectedVersion: props.setupDraft?.version,
          patch: {
            infrastructure: {
              serverType: serverType.trim(),
              image: image.trim(),
              location: location.trim(),
              allowTailscaleUdpIngress: Boolean(allowTailscaleUdpIngress),
            },
          },
        },
      })
    },
    onSuccess: async () => {
      toast.success("Draft saved")
      await queryClient.invalidateQueries({ queryKey: ["setupDraft", props.projectId, props.host] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <div className="space-y-4">
      <DeployCredsCard
        projectId={props.projectId}
        setupDraftFlow={{
          host: props.host,
          setupDraft: props.setupDraft,
        }}
        title="Hetzner token"
        description={(
          <>
            Clawlets provisions this host via Hetzner. Create a dedicated token per project when possible.{" "}
            <a
              className="underline underline-offset-3 hover:text-foreground"
              href="https://docs.clawlets.com/dashboard/hetzner-token"
              target="_blank"
              rel="noreferrer"
            >
              Why and how to create one
            </a>
            .
          </>
        )}
        visibleKeys={["HCLOUD_TOKEN"]}
        headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
      />

      <SettingsSection
        title="Hetzner host configuration"
        description="Set the provisioning defaults for this host."
        statusText={missingRequirements.length > 0 ? `Missing: ${missingRequirements.join(", ")}.` : undefined}
        actions={(
          <AsyncButton
            type="button"
            disabled={saveHostSettings.isPending || !hostConfigReady}
            pending={saveHostSettings.isPending}
            pendingText="Saving..."
            onClick={() => saveHostSettings.mutate()}
          >
            Save host settings
          </AsyncButton>
        )}
      >
        <div className="space-y-4">
          <StackedField
            id="setup-hetzner-server-type"
            label="Server type"
            help={setupFieldHelp.hosts.hetznerServerType}
          >
            <RadioGroup
              value={serverTypeRadioValue}
              onValueChange={(value) => {
                if (value !== HETZNER_RADIO_CUSTOM_VALUE) setServerType(value)
              }}
              className="gap-3"
            >
              {HETZNER_SERVER_TYPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex items-start gap-3 rounded-md border bg-muted/10 p-3",
                    serverTypeRadioValue === option.value && "border-primary bg-muted/20",
                  )}
                >
                  <RadioGroupItem value={option.value} id={`setup-hetzner-server-type-${option.value}`} />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="block text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              ))}
              {!serverTypeKnown && serverTypeTrimmed ? (
                <label className="flex items-start gap-3 rounded-md border border-amber-500/60 bg-amber-500/10 p-3">
                  <RadioGroupItem value={HETZNER_RADIO_CUSTOM_VALUE} id="setup-hetzner-server-type-custom" />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">Custom ({serverTypeTrimmed})</span>
                    <span className="block text-xs text-muted-foreground">
                      Current config value is not in presets. Selecting a preset will replace it.
                    </span>
                  </span>
                </label>
              ) : null}
            </RadioGroup>
          </StackedField>

          <StackedField
            id="setup-hetzner-location"
            label="Location"
            help={setupFieldHelp.hosts.hetznerLocation}
          >
            <RadioGroup
              value={locationRadioValue}
              onValueChange={(value) => {
                if (value !== HETZNER_RADIO_CUSTOM_VALUE) setLocation(value)
              }}
              className="grid gap-3 md:grid-cols-2"
            >
              {HETZNER_LOCATION_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex items-start gap-3 rounded-md border bg-muted/10 p-3",
                    locationRadioValue === option.value && "border-primary bg-muted/20",
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
              {!locationKnown && locationTrimmed ? (
                <label className="flex items-start gap-3 rounded-md border border-amber-500/60 bg-amber-500/10 p-3 md:col-span-2">
                  <RadioGroupItem value={HETZNER_RADIO_CUSTOM_VALUE} id="setup-hetzner-location-custom" />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">Custom ({locationTrimmed})</span>
                    <span className="block text-xs text-muted-foreground">
                      Current config value is not in presets. Selecting a preset will replace it.
                    </span>
                  </span>
                </label>
              ) : null}
            </RadioGroup>
          </StackedField>

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

                  <div>
                    <LabelWithHelp htmlFor="setup-hetzner-udp" help={setupFieldHelp.hosts.hetznerAllowTailscaleUdpIngress}>
                      Allow Tailscale UDP ingress
                    </LabelWithHelp>
                    <div className="mt-2 flex items-center gap-3">
                      <Switch
                        id="setup-hetzner-udp"
                        checked={allowTailscaleUdpIngress}
                        onCheckedChange={setAllowTailscaleUdpIngress}
                      />
                      <span className="text-sm text-muted-foreground">
                        Default: enabled. Disable for relay-only mode.
                      </span>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </SettingsSection>
    </div>
  )
}
