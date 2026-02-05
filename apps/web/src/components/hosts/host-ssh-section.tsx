import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { SettingsSection } from "~/components/ui/settings-section"
import { looksLikeSshPrivateKeyText, looksLikeSshPublicKeyText } from "~/lib/form-utils"
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
        <div className="space-y-2">
          <LabelWithHelp htmlFor="pubkeyFile" help={setupFieldHelp.hosts.sshPubkeyFile}>
            Operator public key file (local path)
          </LabelWithHelp>
          <Input
            id="pubkeyFile"
            value={sshPubkeyFile}
            onChange={(e) => onSshPubkeyFileChange(e.target.value)}
            placeholder="~/.ssh/id_ed25519.pub"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onSshPubkeyFileChange("~/.ssh/id_ed25519.pub")}
            >
              Use ~/.ssh/id_ed25519.pub
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onSshPubkeyFileChange("~/.ssh/id_rsa.pub")}
            >
              Use ~/.ssh/id_rsa.pub
            </Button>
          </div>
          {(() => {
            const v = sshPubkeyFile.trim()
            if (!v) {
              return (
                <div className="text-xs text-destructive">
                  Required for provisioning. This is a local path on the machine running bootstrap.
                </div>
              )
            }
            if (looksLikeSshPrivateKeyText(v)) {
              return (
                <div className="text-xs text-destructive">
                  Private key detected. Do not paste secrets here.
                </div>
              )
            }
            if (looksLikeSshPublicKeyText(v)) {
              return (
                <div className="text-xs text-destructive">
                  Looks like SSH key contents. This field expects a file path.
                </div>
              )
            }
            if (!v.endsWith(".pub")) {
              return (
                <div className="text-xs text-muted-foreground">
                  Warning: does not end with <code>.pub</code>. Double-check this is a public key file path.
                </div>
              )
            }
            return (
              <div className="text-xs text-muted-foreground">
                The dashboard can’t read your filesystem; the CLI validates this path when you run bootstrap/infra.
              </div>
            )
          })()}
        </div>
      </div>
    </SettingsSection>
  )
}

export { HostSshSection }
export type { HostSshSectionProps }
