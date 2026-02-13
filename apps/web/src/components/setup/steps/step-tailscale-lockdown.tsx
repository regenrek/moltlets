import { useMemo } from "react"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SecretInput } from "~/components/ui/secret-input"
import { SettingsSection } from "~/components/ui/settings-section"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import { Switch } from "~/components/ui/switch"
import type { SetupStepStatus } from "~/lib/setup/setup-model"

export function SetupStepTailscaleLockdown(props: {
  stepStatus: SetupStepStatus
  tailscaleAuthKey: string
  hasTailscaleAuthKey: boolean
  useTailscaleLockdown: boolean
  onTailscaleAuthKeyChange: (value: string) => void
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
      : "Enable tailscale lockdown requires a tailscale auth key."

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
              Deploy enables safer SSH path when a tailscale auth key is configured.
            </div>
          </div>
          <Switch
            checked={props.useTailscaleLockdown}
            onCheckedChange={props.onUseTailscaleLockdownChange}
          />
        </div>

        {props.useTailscaleLockdown ? (
          <div className="space-y-2">
            <LabelWithHelp htmlFor="setup-tailscale-key" help="Auth key used for bootstrap tailscale enrollment.">
              Tailscale auth key
            </LabelWithHelp>
            <SecretInput
              id="setup-tailscale-key"
              value={props.tailscaleAuthKey}
              onValueChange={props.onTailscaleAuthKeyChange}
              placeholder={hasTailscaleKey ? "Configured" : "tskey-auth-..."}
            />
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}
