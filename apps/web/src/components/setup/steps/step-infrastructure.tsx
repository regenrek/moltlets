import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { HetznerTokenDialog } from "~/components/setup/hetzner-token-dialog"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { StackedField } from "~/components/ui/stacked-field"
import { Switch } from "~/components/ui/switch"
import { queryKeys } from "~/lib/query-options"
import { setupFieldHelp } from "~/lib/setup-field-help"
import type { SetupConfig } from "~/lib/setup/repo-probe"
import { setupConfigProbeQueryKey } from "~/lib/setup/repo-probe"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import { configDotBatch } from "~/sdk/config/dot"
import type { DeployCredsStatus } from "~/sdk/infra"

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

function resolveHostDefaults(config: SetupConfig | null, host: string) {
  const hostCfg = asRecord(config?.hosts?.[host]) ?? {}
  const hetznerCfg = asRecord(hostCfg.hetzner) ?? {}
  return {
    serverType: asString(hetznerCfg.serverType, "cx43"),
    image: asString(hetznerCfg.image, ""),
    location: asString(hetznerCfg.location, "nbg1"),
    allowTailscaleUdpIngress: asBoolean(hetznerCfg.allowTailscaleUdpIngress, true),
  }
}

function readHcloudTokenState(deployCreds: DeployCredsStatus | null): "set" | "unset" | "unknown" {
  if (!deployCreds) return "unknown"
  const row = deployCreds.keys.find((entry) => entry.key === "HCLOUD_TOKEN")
  if (!row) return "unset"
  return row.status === "set" ? "set" : "unset"
}

export function SetupStepInfrastructure(props: {
  projectId: Id<"projects">
  config: SetupConfig | null
  host: string
  deployCreds: DeployCredsStatus | null
  deployCredsPending: boolean
  deployCredsError: unknown
  stepStatus: SetupStepStatus
  onContinue: () => void
}) {
  const queryClient = useQueryClient()
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false)
  const defaults = resolveHostDefaults(props.config, props.host)
  const [serverType, setServerType] = useState(() => defaults.serverType)
  const [image, setImage] = useState(() => defaults.image)
  const [location, setLocation] = useState(() => defaults.location)
  const [allowTailscaleUdpIngress, setAllowTailscaleUdpIngress] = useState(() => defaults.allowTailscaleUdpIngress)
  const hcloudTokenState = readHcloudTokenState(props.deployCreds)
  const hcloudTokenReady = hcloudTokenState === "set"
  const hostConfigReady = serverType.trim().length > 0 && location.trim().length > 0
  const canContinue = props.stepStatus === "done"
  const missingRequirements = [
    ...(hcloudTokenReady ? [] : ["HCLOUD_TOKEN"]),
    ...(serverType.trim().length > 0 ? [] : ["hetzner.serverType"]),
    ...(location.trim().length > 0 ? [] : ["hetzner.location"]),
  ]

  const saveHostSettings = useMutation({
    mutationFn: async () => {
      if (!props.host.trim()) throw new Error("missing host")
      if (!hostConfigReady) throw new Error("Set server type and location first.")
      return await configDotBatch({
        data: {
          projectId: props.projectId,
          ops: [
            { path: `hosts.${props.host}.provisioning.provider`, value: "hetzner" },
            { path: `hosts.${props.host}.hetzner.serverType`, value: serverType.trim() },
            { path: `hosts.${props.host}.hetzner.image`, value: image.trim() },
            { path: `hosts.${props.host}.hetzner.location`, value: location.trim() },
            {
              path: `hosts.${props.host}.hetzner.allowTailscaleUdpIngress`,
              valueJson: JSON.stringify(Boolean(allowTailscaleUdpIngress)),
            },
          ],
        },
      })
    },
    onSuccess: async (res: any) => {
      if (res.ok) {
        toast.success("Hetzner settings saved")
        await queryClient.invalidateQueries({ queryKey: setupConfigProbeQueryKey(props.projectId) })
        return
      }
      const first = Array.isArray(res.issues) ? res.issues[0] : null
      toast.error(first?.message || "Validation failed")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <div className="space-y-4">
      <SettingsSection
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
        statusText={
          props.deployCredsPending
            ? "Checking HCLOUD_TOKEN status..."
            : props.deployCredsError
              ? "Unable to read token status. Check runner."
              : hcloudTokenState === "set"
                ? "HCLOUD_TOKEN is set for this project."
                : "HCLOUD_TOKEN is not set yet."
        }
        actions={(
          <Button type="button" variant="outline" onClick={() => setTokenDialogOpen(true)}>
            Add or manage
          </Button>
        )}
      >
        <div className="grid gap-2 text-sm text-muted-foreground">
          <div>
            Required for this step: <code>HCLOUD_TOKEN</code>
          </div>
          <div>
            Recommended scope: one token per Clawlets project, backed by a dedicated Hetzner Cloud project.
          </div>
        </div>
      </SettingsSection>

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
            Save
          </AsyncButton>
        )}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <StackedField
            id="setup-hetzner-server-type"
            label="Server type"
            help={setupFieldHelp.hosts.hetznerServerType}
            description='Default: "cx43"'
          >
            <Input
              id="setup-hetzner-server-type"
              value={serverType}
              placeholder="cx43"
              onChange={(event) => setServerType(event.target.value)}
            />
          </StackedField>

          <StackedField
            id="setup-hetzner-location"
            label="Location"
            help={setupFieldHelp.hosts.hetznerLocation}
            description='Default: "nbg1"'
          >
            <Input
              id="setup-hetzner-location"
              value={location}
              placeholder="nbg1"
              onChange={(event) => setLocation(event.target.value)}
            />
          </StackedField>

          <StackedField
            id="setup-hetzner-image"
            label="Image"
            help={setupFieldHelp.hosts.hetznerImage}
            description='Default: empty (uses NixOS path)'
            className="md:col-span-2"
          >
            <Input
              id="setup-hetzner-image"
              value={image}
              placeholder="leave empty for default"
              onChange={(event) => setImage(event.target.value)}
            />
          </StackedField>

          <div className="md:col-span-2">
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
      </SettingsSection>

      {canContinue ? (
        <div className="flex justify-end">
          <Button type="button" onClick={props.onContinue}>
            Continue
          </Button>
        </div>
      ) : null}

      <HetznerTokenDialog
        projectId={props.projectId}
        open={tokenDialogOpen}
        onOpenChange={(open) => {
          setTokenDialogOpen(open)
          if (!open) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.deployCreds(props.projectId) })
          }
        }}
      />
    </div>
  )
}
