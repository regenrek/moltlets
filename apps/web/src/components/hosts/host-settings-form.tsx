import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { AsyncButton } from "~/components/ui/async-button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { HelpTooltip, LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { SettingsSection } from "~/components/ui/settings-section"
import { Switch } from "~/components/ui/switch"
import { AdminCidrField } from "~/components/hosts/admin-cidr-field"
import {
  HostThemeBadge,
  HostThemeColorDropdown,
  HostThemeEmojiPicker,
  normalizeHostTheme,
  type HostThemeColor,
} from "~/components/hosts/host-theme"
import { HostSshSection } from "~/components/hosts/host-ssh-section"
import { HostUpdatesSection } from "~/components/hosts/host-updates-section"
import { HostProviderSettingsSection } from "~/components/hosts/host-provider-settings-section"
import { looksLikeSshPrivateKeyText, looksLikeSshPublicKeyText } from "~/lib/form-utils"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { ConnectivityPanel } from "~/components/hosts/connectivity-panel"
import { configDotSet } from "~/sdk/config"

type SshExposureMode = "tailnet" | "bootstrap" | "public"
type TailnetMode = "tailscale" | "none"

type HostSettingsDraft = {
  enable: boolean
  diskDevice: string
  targetHost: string
  adminCidr: string
  sshPubkeyFile: string
  sshExposure: SshExposureMode
  tailnetMode: TailnetMode
  serverType: string
  hetznerImage: string
  hetznerLocation: string
  hetznerAllowTailscaleUdpIngress: boolean
  flakeHost: string
  agentModelPrimary: string
  hostThemeEmoji: string
  hostThemeColor: HostThemeColor
  selfUpdateEnable: boolean
  selfUpdateChannel: string
  selfUpdateBaseUrls: string
  selfUpdatePublicKeys: string
  selfUpdateAllowUnsigned: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function asSshExposureMode(value: unknown): SshExposureMode {
  return value === "tailnet" || value === "public" ? value : "bootstrap"
}

function asTailnetMode(value: unknown): TailnetMode {
  return value === "none" ? "none" : "tailscale"
}

function toHostThemeInput(value: unknown): { emoji?: string; color?: HostThemeColor } | null {
  const record = asRecord(value)
  if (!record) return null
  const emoji = typeof record.emoji === "string" ? record.emoji : undefined
  const color = typeof record.color === "string" ? (record.color as HostThemeColor) : undefined
  return { ...(emoji ? { emoji } : {}), ...(color ? { color } : {}) }
}

function toHostSettingsDraft(hostCfg: Record<string, unknown>): HostSettingsDraft {
  const provisioning = asRecord(hostCfg.provisioning) ?? {}
  const sshExposure = asRecord(hostCfg.sshExposure) ?? {}
  const tailnet = asRecord(hostCfg.tailnet) ?? {}
  const hetzner = asRecord(hostCfg.hetzner) ?? {}
  const selfUpdate = asRecord(hostCfg.selfUpdate) ?? {}
  const theme = normalizeHostTheme(toHostThemeInput(hostCfg.theme))
  return {
    enable: Boolean(hostCfg.enable),
    diskDevice: asString(hostCfg.diskDevice, "/dev/sda"),
    targetHost: asString(hostCfg.targetHost),
    adminCidr: asString(provisioning.adminCidr),
    sshPubkeyFile: asString(provisioning.sshPubkeyFile),
    sshExposure: asSshExposureMode(sshExposure.mode),
    tailnetMode: asTailnetMode(tailnet.mode),
    serverType: asString(hetzner.serverType, "cx43"),
    hetznerImage: asString(hetzner.image),
    hetznerLocation: asString(hetzner.location, "nbg1"),
    hetznerAllowTailscaleUdpIngress: hetzner.allowTailscaleUdpIngress !== false,
    flakeHost: asString(hostCfg.flakeHost),
    agentModelPrimary: asString(hostCfg.agentModelPrimary),
    hostThemeEmoji: theme.emoji,
    hostThemeColor: theme.color,
    selfUpdateEnable: Boolean(selfUpdate.enable),
    selfUpdateChannel: asString(selfUpdate.channel, "prod"),
    selfUpdateBaseUrls: asStringList(selfUpdate.baseUrls).join("\n"),
    selfUpdatePublicKeys: asStringList(selfUpdate.publicKeys).join("\n"),
    selfUpdateAllowUnsigned: Boolean(selfUpdate.allowUnsigned),
  }
}

function parseTextList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function formatValidationIssues(issues: unknown): string {
  if (!Array.isArray(issues)) return "Validation failed"
  const first = asRecord(issues[0])
  const message = typeof first?.message === "string" ? first.message : "Validation failed"
  const pathSegments = Array.isArray(first?.path) ? first.path.map(String).filter(Boolean) : []
  return pathSegments.length > 0 ? `${message} (${pathSegments.join(".")})` : message
}

export function HostSettingsForm(props: {
  projectId: Id<"projects">
  projectSlug: string
  selectedHost: string
  hostCfg: Record<string, unknown>
  hostConfigQueryKey: readonly unknown[]
}) {
  const queryClient = useQueryClient()
  const initial = toHostSettingsDraft(props.hostCfg)
  const [enable, setEnable] = useState(initial.enable)
  const [diskDevice, setDiskDevice] = useState(initial.diskDevice)
  const [targetHost, setTargetHost] = useState(initial.targetHost)
  const [adminCidr, setAdminCidr] = useState(initial.adminCidr)
  const [sshPubkeyFile, setSshPubkeyFile] = useState(initial.sshPubkeyFile)
  const [sshExposure, setSshExposure] = useState<SshExposureMode>(initial.sshExposure)
  const [tailnetMode, setTailnetMode] = useState<TailnetMode>(initial.tailnetMode)
  const [serverType, setServerType] = useState(initial.serverType)
  const [hetznerImage, setHetznerImage] = useState(initial.hetznerImage)
  const [hetznerLocation, setHetznerLocation] = useState(initial.hetznerLocation)
  const [hetznerAllowTailscaleUdpIngress, setHetznerAllowTailscaleUdpIngress] = useState(initial.hetznerAllowTailscaleUdpIngress)
  const [flakeHost, setFlakeHost] = useState(initial.flakeHost)
  const [agentModelPrimary, setAgentModelPrimary] = useState(initial.agentModelPrimary)
  const [hostThemeEmoji, setHostThemeEmoji] = useState(initial.hostThemeEmoji)
  const [hostThemeColor, setHostThemeColor] = useState<HostThemeColor>(initial.hostThemeColor)
  const [selfUpdateEnable, setSelfUpdateEnable] = useState(initial.selfUpdateEnable)
  const [selfUpdateChannel, setSelfUpdateChannel] = useState(initial.selfUpdateChannel)
  const [selfUpdateBaseUrls, setSelfUpdateBaseUrls] = useState(initial.selfUpdateBaseUrls)
  const [selfUpdatePublicKeys, setSelfUpdatePublicKeys] = useState(initial.selfUpdatePublicKeys)
  const [selfUpdateAllowUnsigned, setSelfUpdateAllowUnsigned] = useState(initial.selfUpdateAllowUnsigned)

  const save = useMutation({
    mutationFn: async () => {
      const sshPubkeyFileTrimmed = sshPubkeyFile.trim()
      if (looksLikeSshPrivateKeyText(sshPubkeyFileTrimmed) || looksLikeSshPublicKeyText(sshPubkeyFileTrimmed)) {
        throw new Error("SSH pubkey file must be a local file path (not key contents). Use Security → SSH Keys to paste keys.")
      }

      const normalizedTheme = normalizeHostTheme({
        emoji: hostThemeEmoji,
        color: hostThemeColor,
      })
      const provisioning = asRecord(props.hostCfg.provisioning) ?? {}
      const sshExposureCfg = asRecord(props.hostCfg.sshExposure) ?? {}
      const tailnetCfg = asRecord(props.hostCfg.tailnet) ?? {}
      const hetznerCfg = asRecord(props.hostCfg.hetzner) ?? {}
      const selfUpdateCfg = asRecord(props.hostCfg.selfUpdate) ?? {}
      const nextHost: Record<string, unknown> = {
        ...props.hostCfg,
        enable,
        diskDevice: diskDevice.trim(),
        targetHost: targetHost.trim() || undefined,
        flakeHost: flakeHost.trim(),
        theme: normalizedTheme,
        provisioning: {
          ...provisioning,
          provider: "hetzner",
          adminCidr: adminCidr.trim(),
          sshPubkeyFile: sshPubkeyFileTrimmed,
        },
        sshExposure: { ...sshExposureCfg, mode: sshExposure },
        tailnet: { ...tailnetCfg, mode: tailnetMode },
        hetzner: {
          ...hetznerCfg,
          serverType: serverType.trim(),
          image: hetznerImage.trim(),
          location: hetznerLocation.trim(),
          allowTailscaleUdpIngress: Boolean(hetznerAllowTailscaleUdpIngress),
        },
        agentModelPrimary: agentModelPrimary.trim(),
        selfUpdate: {
          ...selfUpdateCfg,
          enable: Boolean(selfUpdateEnable),
          channel: selfUpdateChannel.trim(),
          baseUrls: parseTextList(selfUpdateBaseUrls),
          publicKeys: parseTextList(selfUpdatePublicKeys),
          allowUnsigned: Boolean(selfUpdateAllowUnsigned),
        },
      }
      return await configDotSet({
        data: {
          projectId: props.projectId,
          path: `hosts.${props.selectedHost}`,
          valueJson: JSON.stringify(nextHost),
        },
      })
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: props.hostConfigQueryKey })
      } else {
        toast.error(formatValidationIssues(result.issues))
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    },
  })

  return (
    <div className="space-y-6">
      <ConnectivityPanel
        projectId={props.projectId}
        host={props.selectedHost}
        targetHost={targetHost}
      />

      <SettingsSection
        title="Host Status"
        description={<>Stored in <code className="text-xs">hosts.{props.selectedHost}</code></>}
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span>Enabled</span>
              <HelpTooltip title="Enabled" side="top">
                {setupFieldHelp.hosts.enabled}
              </HelpTooltip>
            </div>
            <Switch checked={enable} onCheckedChange={setEnable} />
          </div>
        }
      >
        <div className="text-lg font-semibold">{props.selectedHost}</div>
      </SettingsSection>

      <SettingsSection
        title="Host Theme"
        description="Shown in the sidebar and header when this host is active."
        actions={<AsyncButton disabled={save.isPending} pending={save.isPending} pendingText="Saving..." onClick={() => save.mutate()}>Save</AsyncButton>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Emoji</Label>
            <HostThemeEmojiPicker
              value={hostThemeEmoji}
              onValueChange={setHostThemeEmoji}
            />
          </div>
          <div className="space-y-2">
            <Label>Color set</Label>
            <HostThemeColorDropdown
              value={hostThemeColor}
              onValueChange={setHostThemeColor}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
          <HostThemeBadge
            theme={{ emoji: hostThemeEmoji, color: hostThemeColor }}
            size="md"
          />
          <div className="text-sm text-muted-foreground">
            Active host badge.
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Infrastructure Provider"
        description="Web settings currently support the Hetzner production path."
        statusText="Day 0 infrastructure lifecycle"
        actions={<AsyncButton disabled={save.isPending} pending={save.isPending} pendingText="Saving..." onClick={() => save.mutate()}>Save</AsyncButton>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <LabelWithHelp htmlFor="provider" help={setupFieldHelp.hosts.provider}>
              Provider
            </LabelWithHelp>
            <Input id="provider" value="hetzner" readOnly />
          </div>
          <div className="text-sm text-muted-foreground">
            Day 0 includes <code>bootstrap</code>/<code>infra</code>/<code>lockdown</code>.
            OpenClaw gateway config remains Day X and is provider-neutral.
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Connection"
        description="SSH target and admin access settings."
        statusText="Used for provisioning access."
        actions={<AsyncButton disabled={save.isPending} pending={save.isPending} pendingText="Saving..." onClick={() => save.mutate()}>Save</AsyncButton>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <LabelWithHelp htmlFor="target" help={setupFieldHelp.hosts.targetHost}>
              SSH targetHost
            </LabelWithHelp>
            <Input id="target" value={targetHost} onChange={(event) => setTargetHost(event.target.value)} placeholder="ssh-alias or user@host" />
          </div>
          <AdminCidrField
            id="adminCidr"
            label="Admin CIDR"
            help={setupFieldHelp.hosts.adminCidr}
            value={adminCidr}
            onValueChange={setAdminCidr}
          />
        </div>
      </SettingsSection>

      <HostUpdatesSection
        projectSlug={props.projectSlug}
        host={props.selectedHost}
        selfUpdateEnable={selfUpdateEnable}
        selfUpdateChannel={selfUpdateChannel}
        selfUpdateBaseUrls={selfUpdateBaseUrls}
        selfUpdatePublicKeys={selfUpdatePublicKeys}
        selfUpdateAllowUnsigned={selfUpdateAllowUnsigned}
        onSelfUpdateEnableChange={setSelfUpdateEnable}
        onSelfUpdateChannelChange={setSelfUpdateChannel}
        onSelfUpdateBaseUrlsChange={setSelfUpdateBaseUrls}
        onSelfUpdatePublicKeysChange={setSelfUpdatePublicKeys}
        onSelfUpdateAllowUnsignedChange={setSelfUpdateAllowUnsigned}
        onSave={() => save.mutate()}
        saving={save.isPending}
      />

      <HostSshSection
        sshExposure={sshExposure}
        sshPubkeyFile={sshPubkeyFile}
        onSshExposureChange={setSshExposure}
        onSshPubkeyFileChange={setSshPubkeyFile}
        onSave={() => save.mutate()}
        saving={save.isPending}
      />

      <SettingsSection
        title="Network"
        description="VPN and tailnet configuration."
        actions={<AsyncButton disabled={save.isPending} pending={save.isPending} pendingText="Saving..." onClick={() => save.mutate()}>Save</AsyncButton>}
      >
        <div className="space-y-2 max-w-xs">
          <LabelWithHelp htmlFor="tailnetMode" help={setupFieldHelp.hosts.tailnet}>
            Tailnet mode
          </LabelWithHelp>
          <NativeSelect id="tailnetMode" value={tailnetMode} onChange={(event) => setTailnetMode(asTailnetMode(event.target.value))}>
            <NativeSelectOption value="tailscale">tailscale</NativeSelectOption>
            <NativeSelectOption value="none">none</NativeSelectOption>
          </NativeSelect>
        </div>
      </SettingsSection>

      <HostProviderSettingsSection
        saving={save.isPending}
        onSave={() => save.mutate()}
        serverType={serverType}
        setServerType={setServerType}
        hetznerImage={hetznerImage}
        setHetznerImage={setHetznerImage}
        hetznerLocation={hetznerLocation}
        setHetznerLocation={setHetznerLocation}
        hetznerAllowTailscaleUdpIngress={hetznerAllowTailscaleUdpIngress}
        setHetznerAllowTailscaleUdpIngress={setHetznerAllowTailscaleUdpIngress}
      />

      <SettingsSection
        title="NixOS Configuration"
        description="System-level NixOS settings."
        actions={<AsyncButton disabled={save.isPending} pending={save.isPending} pendingText="Saving..." onClick={() => save.mutate()}>Save</AsyncButton>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <LabelWithHelp htmlFor="disk" help={setupFieldHelp.hosts.diskDevice}>
              Disk device
            </LabelWithHelp>
            <Input id="disk" value={diskDevice} onChange={(event) => setDiskDevice(event.target.value)} />
          </div>
          <div className="space-y-2">
            <LabelWithHelp htmlFor="flakeHost" help={setupFieldHelp.hosts.flakeHost}>
              Flake host override
            </LabelWithHelp>
            <Input id="flakeHost" value={flakeHost} onChange={(event) => setFlakeHost(event.target.value)} />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Agent"
        description="AI agent model configuration."
        statusText="Format: provider/model"
        actions={<AsyncButton disabled={save.isPending} pending={save.isPending} pendingText="Saving..." onClick={() => save.mutate()}>Save</AsyncButton>}
      >
        <div className="space-y-2 max-w-md">
          <LabelWithHelp htmlFor="model" help={setupFieldHelp.hosts.agentModelPrimary}>
            Primary model
          </LabelWithHelp>
          <Input id="model" value={agentModelPrimary} onChange={(event) => setAgentModelPrimary(event.target.value)} placeholder="provider/model" />
        </div>
      </SettingsSection>
    </div>
  )
}
