import { useMemo } from "react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { ProjectTokenKeyringCard } from "~/components/setup/project-token-keyring-card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import { Switch } from "~/components/ui/switch"
import { setupFieldHelp } from "~/lib/setup-field-help"
import type { SetupStepStatus } from "~/lib/setup/setup-model"

export function SetupStepTailscaleLockdown(props: {
  projectId: Id<"projects">
  stepStatus: SetupStepStatus
  tailscaleAuthKey: string
  hasTailscaleAuthKey: boolean
  allowTailscaleUdpIngress: boolean
  useTailscaleLockdown: boolean
  onTailscaleAuthKeyChange: (value: string) => void
  onAllowTailscaleUdpIngressChange: (value: boolean) => void
  onUseTailscaleLockdownChange: (value: boolean) => void
}) {
  const hasTailscaleKey = useMemo(
    () => props.hasTailscaleAuthKey || props.tailscaleAuthKey.trim().length > 0,
    [props.hasTailscaleAuthKey, props.tailscaleAuthKey],
  )

  const statusText = !props.useTailscaleLockdown
    ? "Tailscale lockdown disabled."
    : hasTailscaleKey
      ? "Tailscale key ready for deploy."
      : "Enable tailscale lockdown requires an active Tailscale key."

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
          <ProjectTokenKeyringCard
            projectId={props.projectId}
            kind="tailscale"
            title="Tailscale API keys"
            description="Project-wide keys. Add multiple keys and select the one used for setup/deploy."
            onActiveValueChange={props.onTailscaleAuthKeyChange}
            showRunnerStatusBanner={false}
            showRunnerStatusDetails={false}
          />
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
