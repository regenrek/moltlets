import { Button } from "~/components/ui/button"
import { SshPubkeyFileField } from "~/components/hosts/ssh-pubkey-file-field"
import { LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { SettingsSection } from "~/components/ui/settings-section"
import { setupFieldHelp } from "~/lib/setup-field-help"

type HostSshSectionProps = {
  sshExposure: "tailnet" | "bootstrap" | "public"
  sshPubkeyFile: string
  onSshExposureChange: (value: "tailnet" | "bootstrap" | "public") => void
  onSshPubkeyFileChange: (value: string) => void
  onSave: () => void
  saving: boolean
}

function HostSshSection({
  sshExposure,
  sshPubkeyFile,
  onSshExposureChange,
  onSshPubkeyFileChange,
  onSave,
  saving,
}: HostSshSectionProps) {
  return (
    <SettingsSection
      title="SSH Connectivity"
      description="Controls how operators reach this host via SSH (network exposure + which local public key file to use during provisioning)."
      actions={<Button disabled={saving} onClick={onSave}>Save</Button>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <LabelWithHelp htmlFor="sshExposure" help={setupFieldHelp.hosts.sshExposure}>
            SSH exposure
          </LabelWithHelp>
          <NativeSelect
            id="sshExposure"
            value={sshExposure}
            onChange={(e) => onSshExposureChange(e.target.value as HostSshSectionProps["sshExposure"])}
          >
            <NativeSelectOption value="tailnet">tailnet</NativeSelectOption>
            <NativeSelectOption value="bootstrap">bootstrap</NativeSelectOption>
            <NativeSelectOption value="public">public</NativeSelectOption>
          </NativeSelect>
        </div>
        <SshPubkeyFileField
          id="pubkeyFile"
          label="Operator public key file (local path)"
          help={setupFieldHelp.hosts.sshPubkeyFile}
          value={sshPubkeyFile}
          onValueChange={onSshPubkeyFileChange}
        />
      </div>
    </SettingsSection>
  )
}

export { HostSshSection }
export type { HostSshSectionProps }
