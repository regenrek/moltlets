import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { Switch } from "~/components/ui/switch"
import { setupFieldHelp } from "~/lib/setup-field-help"

export function HostProviderSettingsSection(props: {
  saving: boolean
  onSave: () => void
  serverType: string
  setServerType: (value: string) => void
  hetznerImage: string
  setHetznerImage: (value: string) => void
  hetznerLocation: string
  setHetznerLocation: (value: string) => void
  hetznerAllowTailscaleUdpIngress: boolean
  setHetznerAllowTailscaleUdpIngress: (value: boolean) => void
}) {
  return (
    <SettingsSection
      title="Hetzner Cloud"
      description="Provider-specific settings for Hetzner hosts."
      actions={<Button disabled={props.saving} onClick={props.onSave}>Save</Button>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <LabelWithHelp htmlFor="serverType" help={setupFieldHelp.hosts.hetznerServerType}>
            Server type
          </LabelWithHelp>
          <Input id="serverType" value={props.serverType} onChange={(event) => props.setServerType(event.target.value)} />
        </div>
        <div className="space-y-2">
          <LabelWithHelp htmlFor="location" help={setupFieldHelp.hosts.hetznerLocation}>
            Location
          </LabelWithHelp>
          <Input id="location" value={props.hetznerLocation} onChange={(event) => props.setHetznerLocation(event.target.value)} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <LabelWithHelp htmlFor="image" help={setupFieldHelp.hosts.hetznerImage}>
            Image
          </LabelWithHelp>
          <Input id="image" value={props.hetznerImage} onChange={(event) => props.setHetznerImage(event.target.value)} />
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <Switch checked={props.hetznerAllowTailscaleUdpIngress} onCheckedChange={props.setHetznerAllowTailscaleUdpIngress} />
          <div className="text-sm text-muted-foreground">{setupFieldHelp.hosts.hetznerAllowTailscaleUdpIngress}</div>
        </div>
      </div>
    </SettingsSection>
  )
}
