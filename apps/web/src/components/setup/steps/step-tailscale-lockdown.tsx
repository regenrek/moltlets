import { useMutation } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { AsyncButton } from "~/components/ui/async-button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SecretInput } from "~/components/ui/secret-input"
import { SettingsSection } from "~/components/ui/settings-section"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import { Switch } from "~/components/ui/switch"
import { PROJECT_TOKEN_KEY_LABEL_MAX_CHARS, PROJECT_TOKEN_VALUE_MAX_CHARS } from "~/lib/project-token-keyring"
import { setupFieldHelp } from "~/lib/setup-field-help"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import { mutateProjectTokenKeyring } from "~/sdk/infra"

export function SetupStepTailscaleLockdown(props: {
  projectId: Id<"projects">
  projectSlug: string
  stepStatus: SetupStepStatus
  hasTailscaleAuthKey: boolean
  allowTailscaleUdpIngress: boolean
  useTailscaleLockdown: boolean
  targetRunner: {
    _id: Id<"runners">
    runnerName: string
  } | null
  isVisible: boolean
  onAllowTailscaleUdpIngressChange: (value: boolean) => void
  onUseTailscaleLockdownChange: (value: boolean) => void
}) {
  const hasTailscaleKey = useMemo(
    () => props.hasTailscaleAuthKey,
    [props.hasTailscaleAuthKey],
  )

  const statusText = !props.useTailscaleLockdown
    ? "Tailscale lockdown disabled."
    : hasTailscaleKey
      ? "Tailscale key ready for deploy."
      : "Enable tailscale lockdown requires an active Tailscale key."

  const [newLabel, setNewLabel] = useState("")
  const [newValue, setNewValue] = useState("")
  const addKey = useMutation({
    mutationFn: async () => {
      if (!props.targetRunner) throw new Error("Select a sealed-capable runner above.")
      const label = newLabel.trim()
      const value = newValue.trim()
      if (!value) throw new Error("Tailscale auth key is required")
      if (value.length > PROJECT_TOKEN_VALUE_MAX_CHARS) {
        throw new Error(`Key too long (max ${PROJECT_TOKEN_VALUE_MAX_CHARS} characters)`)
      }
      if (label.length > PROJECT_TOKEN_KEY_LABEL_MAX_CHARS) {
        throw new Error(`Label too long (max ${PROJECT_TOKEN_KEY_LABEL_MAX_CHARS} characters)`)
      }
      return await mutateProjectTokenKeyring({
        data: {
          projectId: props.projectId,
          kind: "tailscale",
          action: "add",
          targetRunnerId: String(props.targetRunner._id) as Id<"runners">,
          label,
          value,
        },
      })
    },
    onSuccess: () => {
      toast.success("Tailscale key queued")
      setNewLabel("")
      setNewValue("")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <SettingsSection
      title="Tailscale lockdown"
      description="Enable safer SSH exposure with Tailnet before deploy."
      headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
      statusText={statusText}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Use tailscale + lockdown (recommended)</div>
            <div className="text-xs text-muted-foreground">
              Deploy enables safer SSH path when an active project Tailscale key is configured.
            </div>
          </div>
          <Switch
            checked={props.useTailscaleLockdown}
            onCheckedChange={props.onUseTailscaleLockdownChange}
          />
        </div>
        {props.useTailscaleLockdown ? (
          <div className="space-y-2">
            <LabelWithHelp htmlFor="setup-tailscale-keyring" help={setupFieldHelp.secrets.tailscaleAuthKey}>
              Tailscale API keys
            </LabelWithHelp>
            <div className="text-xs text-muted-foreground">
              Project-wide keys. Add multiple keys and select the one used for setup/deploy.
            </div>
            <div id="setup-tailscale-keyring" className="space-y-2 rounded-md border bg-muted/10 p-3">
              {!props.targetRunner ? (
                <div className="text-xs text-muted-foreground">
                  Select a target runner above to manage keys.
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Active key</div>
                <div className={hasTailscaleKey ? "text-xs font-medium text-emerald-700" : "text-xs font-medium text-destructive"}>
                  {hasTailscaleKey ? "Set" : "Missing"}
                </div>
              </div>

              {!hasTailscaleKey && props.isVisible ? (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <LabelWithHelp htmlFor="setup-tailscale-key-label" help="Optional label for your auth key.">
                      Label (optional)
                    </LabelWithHelp>
                    <Input
                      id="setup-tailscale-key-label"
                      value={newLabel}
                      placeholder="e.g. laptop"
                      onChange={(event) => setNewLabel(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <LabelWithHelp htmlFor="setup-tailscale-key-value" help={setupFieldHelp.secrets.tailscaleAuthKey}>
                      Auth key
                    </LabelWithHelp>
                    <SecretInput
                      id="setup-tailscale-key-value"
                      value={newValue}
                      onValueChange={setNewValue}
                      placeholder="tskey-auth-..."
                    />
                  </div>
                  <AsyncButton
                    type="button"
                    pending={addKey.isPending}
                    pendingText="Queuing..."
                    disabled={!props.targetRunner || !newValue.trim()}
                    onClick={() => addKey.mutate()}
                  >
                    Save key
                  </AsyncButton>
                </div>
              ) : null}

              <div className="text-xs text-muted-foreground">
                Manage keys:{" "}
                <Link
                  to="/$projectSlug/security/api-keys"
                  params={{ projectSlug: props.projectSlug }}
                  className="underline underline-offset-2"
                >
                  API keys
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        <Accordion className="rounded-lg border bg-muted/20">
          <AccordionItem value="advanced" className="px-4">
            <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
              Advanced options
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="space-y-2 rounded-md border bg-muted/10 p-3">
                <LabelWithHelp
                  htmlFor="setup-tailscale-udp-ingress"
                  help={setupFieldHelp.hosts.hetznerAllowTailscaleUdpIngress}
                >
                  Allow Tailscale UDP ingress
                </LabelWithHelp>
                <div className="mt-1 flex items-center gap-3">
                  <Switch
                    id="setup-tailscale-udp-ingress"
                    checked={props.allowTailscaleUdpIngress}
                    onCheckedChange={props.onAllowTailscaleUdpIngressChange}
                  />
                  <span className="text-sm text-muted-foreground">
                    Default: enabled. Disable for relay-only mode.
                  </span>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </SettingsSection>
  )
}
