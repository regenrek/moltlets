import { AsyncButton } from "~/components/ui/async-button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { SettingsSection } from "~/components/ui/settings-section"
import { StackedField } from "~/components/ui/stacked-field"
import { Switch } from "~/components/ui/switch"
import {
  HETZNER_LOCATION_OPTIONS,
  HETZNER_SERVER_TYPE_OPTIONS,
  HETZNER_SETUP_DEFAULT_LOCATION,
  HETZNER_SETUP_DEFAULT_SERVER_TYPE,
  isKnownHetznerLocation,
  isKnownHetznerServerType,
} from "~/components/hosts/hetzner-options"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { cn } from "~/lib/utils"

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
  const serverTypeRaw = props.serverType.trim()
  const locationRaw = props.hetznerLocation.trim()
  const serverType = isKnownHetznerServerType(serverTypeRaw) ? serverTypeRaw : HETZNER_SETUP_DEFAULT_SERVER_TYPE
  const location = isKnownHetznerLocation(locationRaw) ? locationRaw : HETZNER_SETUP_DEFAULT_LOCATION

  return (
    <SettingsSection
      title="Hetzner Cloud"
      description="Provider-specific settings for Hetzner hosts."
      actions={
        <AsyncButton disabled={props.saving} pending={props.saving} pendingText="Saving..." onClick={props.onSave}>
          Save
        </AsyncButton>
      }
    >
      <div className="space-y-4">
        <StackedField
          id="serverType"
          label="Server type"
          help={setupFieldHelp.hosts.hetznerServerType}
        >
          <RadioGroup
            value={serverType}
            onValueChange={props.setServerType}
            className="gap-3"
          >
            {HETZNER_SERVER_TYPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex items-start gap-3 rounded-md border bg-muted/10 p-3",
                  serverType === option.value && "border-primary bg-muted/20",
                )}
              >
                <RadioGroupItem value={option.value} id={`serverType-${option.value}`} />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </StackedField>

        <StackedField
          id="location"
          label="Location"
          help={setupFieldHelp.hosts.hetznerLocation}
        >
          <RadioGroup
            value={location}
            onValueChange={props.setHetznerLocation}
            className="grid gap-3 md:grid-cols-2"
          >
            {HETZNER_LOCATION_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex items-start gap-3 rounded-md border bg-muted/10 p-3",
                  location === option.value && "border-primary bg-muted/20",
                )}
              >
                <RadioGroupItem value={option.value} id={`location-${option.value}`} />
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

        <Accordion className="rounded-lg border bg-muted/20">
          <AccordionItem value="advanced" className="px-4">
            <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
              Advanced options
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="space-y-4">
                <StackedField
                  id="image"
                  label="Image"
                  help={setupFieldHelp.hosts.hetznerImage}
                  description='Default: empty (uses NixOS path)'
                >
                  <Input
                    id="image"
                    value={props.hetznerImage}
                    placeholder="leave empty for default"
                    onChange={(event) => props.setHetznerImage(event.target.value)}
                  />
                </StackedField>

                <div>
                  <LabelWithHelp htmlFor="hetznerUdpIngress" help={setupFieldHelp.hosts.hetznerAllowTailscaleUdpIngress}>
                    Allow Tailscale UDP ingress
                  </LabelWithHelp>
                  <div className="mt-2 flex items-center gap-3">
                    <Switch
                      id="hetznerUdpIngress"
                      checked={props.hetznerAllowTailscaleUdpIngress}
                      onCheckedChange={props.setHetznerAllowTailscaleUdpIngress}
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
  )
}
