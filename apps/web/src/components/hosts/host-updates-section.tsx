import { Link } from "@tanstack/react-router"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { SettingsSection } from "~/components/ui/settings-section"
import { Switch } from "~/components/ui/switch"
import { Textarea } from "~/components/ui/textarea"

type HostUpdatesSectionProps = {
  projectSlug: string
  host: string
  selfUpdateEnable: boolean
  selfUpdateChannel: string
  selfUpdateBaseUrls: string
  selfUpdatePublicKeys: string
  selfUpdateAllowUnsigned: boolean
  onSelfUpdateEnableChange: (value: boolean) => void
  onSelfUpdateChannelChange: (value: string) => void
  onSelfUpdateBaseUrlsChange: (value: string) => void
  onSelfUpdatePublicKeysChange: (value: string) => void
  onSelfUpdateAllowUnsignedChange: (value: boolean) => void
  onSave: () => void
  saving: boolean
}

function HostUpdatesSection({
  projectSlug,
  host,
  selfUpdateEnable,
  selfUpdateChannel,
  selfUpdateBaseUrls,
  selfUpdatePublicKeys,
  selfUpdateAllowUnsigned,
  onSelfUpdateEnableChange,
  onSelfUpdateChannelChange,
  onSelfUpdateBaseUrlsChange,
  onSelfUpdatePublicKeysChange,
  onSelfUpdateAllowUnsignedChange,
  onSave,
  saving,
}: HostUpdatesSectionProps) {
  return (
    <SettingsSection
      title="Updates (pull-only)"
      description={
        <>
          Per-host update ring and signature settings (stored in{" "}
          <code className="text-xs">hosts.{host}.selfUpdate</code>). Use rings (e.g. prod/staging/canary) to stage updates across many hosts.
        </>
      }
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link to="/$projectSlug/hosts/$host/deploy" params={{ projectSlug, host }} />}
          >
            Open Deploy
          </Button>
          <Button disabled={saving} onClick={onSave}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Enable self-updates</div>
            <div className="text-xs text-muted-foreground">
              Requires baseUrls + (publicKeys or allowUnsigned).
            </div>
          </div>
          <Switch checked={selfUpdateEnable} onCheckedChange={onSelfUpdateEnableChange} />
        </div>

        <div className="space-y-2">
          <Label>Update ring (channel)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={selfUpdateChannel.trim() === "prod" ? "default" : "outline"}
              onClick={() => onSelfUpdateChannelChange("prod")}
            >
              prod
            </Button>
            <Button
              type="button"
              size="sm"
              variant={selfUpdateChannel.trim() === "staging" ? "default" : "outline"}
              onClick={() => onSelfUpdateChannelChange("staging")}
            >
              staging
            </Button>
            <Button
              type="button"
              size="sm"
              variant={selfUpdateChannel.trim() === "canary" ? "default" : "outline"}
              onClick={() => onSelfUpdateChannelChange("canary")}
            >
              canary
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Channel is used to resolve <code>latest.json</code> pointers on the host.
          </div>
          <Input
            value={selfUpdateChannel}
            onChange={(e) => onSelfUpdateChannelChange(e.target.value)}
            placeholder="prod"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Update mirrors (baseUrls)</Label>
          <Textarea
            value={selfUpdateBaseUrls}
            onChange={(e) => onSelfUpdateBaseUrlsChange(e.target.value)}
            placeholder={"https://example.com/deploy\nhttps://mirror.example.com/deploy"}
            className="min-h-[120px] font-mono"
          />
          <div className="text-xs text-muted-foreground">One URL per line.</div>
        </div>

        <div className="space-y-2">
          <Label>Minisign public keys</Label>
          <Textarea
            value={selfUpdatePublicKeys}
            onChange={(e) => onSelfUpdatePublicKeysChange(e.target.value)}
            placeholder={"RWR...your-minisign-public-key...\nRWR...second-key..."}
            className="min-h-[120px] font-mono"
          />
          <div className="text-xs text-muted-foreground">One key per line.</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Allow unsigned updates (dev-only)</div>
          <div className="text-xs text-muted-foreground">
            Disables signature verification. Use only for local/dev experiments.
          </div>
        </div>
        <Switch checked={selfUpdateAllowUnsigned} onCheckedChange={onSelfUpdateAllowUnsignedChange} />
      </div>
    </SettingsSection>
  )
}

export { HostUpdatesSection }
export type { HostUpdatesSectionProps }
