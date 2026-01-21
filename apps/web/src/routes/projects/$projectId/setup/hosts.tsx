import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { Switch } from "~/components/ui/switch"
import { Textarea } from "~/components/ui/textarea"
import { addHost, addHostSshKeys, getClawdletsConfig, writeClawdletsConfigFile } from "~/sdk/config"

export const Route = createFileRoute("/projects/$projectId/setup/hosts")({
  component: HostsSetup,
})

function HostsSetup() {
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })

  const config = cfg.data?.config
  const hosts = useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])

  const [newHost, setNewHost] = useState("")
  const addHostMutation = useMutation({
    mutationFn: async () =>
      await addHost({ data: { projectId: projectId as Id<"projects">, host: newHost } }),
    onSuccess: () => {
      toast.success("Host added")
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
    },
  })

  const [selectedHost, setSelectedHost] = useState("")
  useEffect(() => {
    if (!config) return
    if (selectedHost) return
    setSelectedHost(config.defaultHost || hosts[0] || "")
  }, [config, hosts, selectedHost])

  const hostCfg = selectedHost && config ? config.hosts[selectedHost] : null

  const [defaultHost, setDefaultHost] = useState("")
  const [enable, setEnable] = useState(false)
  const [diskDevice, setDiskDevice] = useState("/dev/sda")
  const [targetHost, setTargetHost] = useState("")
  const [adminCidr, setAdminCidr] = useState("")
  const [sshPubkeyFile, setSshPubkeyFile] = useState("~/.ssh/id_ed25519.pub")
  const [sshExposure, setSshExposure] = useState<"tailnet" | "bootstrap" | "public">("bootstrap")
  const [tailnetMode, setTailnetMode] = useState<"tailscale" | "none">("tailscale")
  const [serverType, setServerType] = useState("cx43")
  const [hetznerImage, setHetznerImage] = useState("")
  const [hetznerLocation, setHetznerLocation] = useState("nbg1")
  const [flakeHost, setFlakeHost] = useState("")
  const [agentModelPrimary, setAgentModelPrimary] = useState("")

  useEffect(() => {
    if (!config) return
    setDefaultHost(config.defaultHost || "")
  }, [config])

  useEffect(() => {
    if (!hostCfg) return
    setEnable(Boolean(hostCfg.enable))
    setDiskDevice(hostCfg.diskDevice || "/dev/sda")
    setTargetHost(hostCfg.targetHost || "")
    setAdminCidr(hostCfg.provisioning?.adminCidr || "")
    setSshPubkeyFile(hostCfg.provisioning?.sshPubkeyFile || "~/.ssh/id_ed25519.pub")
    setSshExposure((hostCfg.sshExposure?.mode as any) || "bootstrap")
    setTailnetMode((hostCfg.tailnet?.mode as any) || "tailscale")
    setServerType(hostCfg.hetzner?.serverType || "cx43")
    setHetznerImage(hostCfg.hetzner?.image || "")
    setHetznerLocation(hostCfg.hetzner?.location || "nbg1")
    setFlakeHost(hostCfg.flakeHost || "")
    setAgentModelPrimary((hostCfg as any).agentModelPrimary || "")
  }, [hostCfg, selectedHost])

  const save = useMutation({
    mutationFn: async () => {
      if (!config || !hostCfg) throw new Error("missing host")
      const next = {
        ...config,
        defaultHost: defaultHost || config.defaultHost,
        hosts: {
          ...config.hosts,
          [selectedHost]: {
            ...hostCfg,
            enable,
            diskDevice: diskDevice.trim(),
            targetHost: targetHost.trim() || undefined,
            flakeHost: flakeHost.trim(),
            provisioning: {
              ...hostCfg.provisioning,
              adminCidr: adminCidr.trim(),
              sshPubkeyFile: sshPubkeyFile.trim(),
            },
            sshExposure: { ...hostCfg.sshExposure, mode: sshExposure },
            tailnet: { ...hostCfg.tailnet, mode: tailnetMode },
            hetzner: {
              ...hostCfg.hetzner,
              serverType: serverType.trim(),
              image: hetznerImage.trim(),
              location: hetznerLocation.trim(),
            },
            agentModelPrimary: agentModelPrimary.trim(),
          },
        },
      }
      return await writeClawdletsConfigFile({
        data: { projectId: projectId as Id<"projects">, next, title: `Update host ${selectedHost}` },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Validation failed")
    },
  })

  const [keyText, setKeyText] = useState("")
  const [keyFilePath, setKeyFilePath] = useState("")
  const [knownHostsFilePath, setKnownHostsFilePath] = useState("")

  const addSsh = useMutation({
    mutationFn: async () => {
      if (!selectedHost) throw new Error("select a host")
      return await addHostSshKeys({
        data: {
          projectId: projectId as Id<"projects">,
          host: selectedHost,
          keyText,
          keyFilePath,
          knownHostsFilePath,
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Updated SSH settings")
        setKeyText("")
        setKeyFilePath("")
        setKnownHostsFilePath("")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Failed")
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Hosts</h1>
      <p className="text-muted-foreground">
        Manage hosts, SSH targets, and access settings.
      </p>

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="font-medium">Hosts</div>
            <div className="space-y-2">
              <Label htmlFor="defaultHost">Default host</Label>
              <NativeSelect
                id="defaultHost"
                value={defaultHost}
                onChange={(e) => setDefaultHost(e.target.value)}
              >
                <NativeSelectOption value="">(unset)</NativeSelectOption>
                {hosts.map((h) => (
                  <NativeSelectOption key={h} value={h}>
                    {h}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hostSelect">Edit host</Label>
              <NativeSelect id="hostSelect" value={selectedHost} onChange={(e) => setSelectedHost(e.target.value)}>
                <NativeSelectOption value="">(select)</NativeSelectOption>
                {hosts.map((h) => (
                  <NativeSelectOption key={h} value={h}>
                    {h}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            <div className="border-t pt-4 space-y-2">
              <Label htmlFor="newHost">Add host</Label>
              <Input id="newHost" placeholder="my-host" value={newHost} onChange={(e) => setNewHost(e.target.value)} />
              <Button type="button" disabled={addHostMutation.isPending || !newHost.trim()} onClick={() => addHostMutation.mutate()}>
                Add
              </Button>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-6">
            {hostCfg ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold truncate">{selectedHost}</div>
                    <div className="text-xs text-muted-foreground">
                      Stored in <code>hosts.{selectedHost}</code>.
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground">Enabled</div>
                    <Switch checked={enable} onCheckedChange={setEnable} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="disk">Disk device</Label>
                    <Input id="disk" value={diskDevice} onChange={(e) => setDiskDevice(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="target">SSH targetHost</Label>
                    <Input id="target" value={targetHost} onChange={(e) => setTargetHost(e.target.value)} placeholder="ssh-alias or user@host" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="adminCidr">Admin CIDR</Label>
                    <Input id="adminCidr" value={adminCidr} onChange={(e) => setAdminCidr(e.target.value)} placeholder="203.0.113.10/32" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pubkeyFile">SSH pubkey file</Label>
                    <Input id="pubkeyFile" value={sshPubkeyFile} onChange={(e) => setSshPubkeyFile(e.target.value)} />
                  </div>

                  <div className="space-y-2">
                    <Label>SSH exposure</Label>
                    <NativeSelect value={sshExposure} onChange={(e) => setSshExposure(e.target.value as any)}>
                      <NativeSelectOption value="tailnet">tailnet</NativeSelectOption>
                      <NativeSelectOption value="bootstrap">bootstrap</NativeSelectOption>
                      <NativeSelectOption value="public">public</NativeSelectOption>
                    </NativeSelect>
                  </div>
                  <div className="space-y-2">
                    <Label>Tailnet</Label>
                    <NativeSelect value={tailnetMode} onChange={(e) => setTailnetMode(e.target.value as any)}>
                      <NativeSelectOption value="tailscale">tailscale</NativeSelectOption>
                      <NativeSelectOption value="none">none</NativeSelectOption>
                    </NativeSelect>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="serverType">Hetzner serverType</Label>
                    <Input id="serverType" value={serverType} onChange={(e) => setServerType(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">Hetzner location</Label>
                    <Input id="location" value={hetznerLocation} onChange={(e) => setHetznerLocation(e.target.value)} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="image">Hetzner image</Label>
                    <Input id="image" value={hetznerImage} onChange={(e) => setHetznerImage(e.target.value)} />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="flakeHost">Flake host override</Label>
                    <Input id="flakeHost" value={flakeHost} onChange={(e) => setFlakeHost(e.target.value)} />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="model">Agent model (primary)</Label>
                    <Input id="model" value={agentModelPrimary} onChange={(e) => setAgentModelPrimary(e.target.value)} placeholder="zai/glm-4.7" />
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <div className="font-medium text-sm">SSH key import</div>
                  <div className="text-xs text-muted-foreground">
                    Adds to <code>hosts.{selectedHost}.sshAuthorizedKeys</code> and optionally imports known_hosts entries.
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="keyText">Paste public keys</Label>
                      <Textarea
                        id="keyText"
                        value={keyText}
                        onChange={(e) => setKeyText(e.target.value)}
                        className="font-mono min-h-[100px]"
                        placeholder="ssh-ed25519 AAAA... user@host"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="keyFile">Key file path (.pub)</Label>
                      <Input id="keyFile" value={keyFilePath} onChange={(e) => setKeyFilePath(e.target.value)} placeholder="~/.ssh/id_ed25519.pub" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="knownHosts">known_hosts file path</Label>
                      <Input id="knownHosts" value={knownHostsFilePath} onChange={(e) => setKnownHostsFilePath(e.target.value)} placeholder="~/.ssh/known_hosts" />
                    </div>
                  </div>
                  <Button type="button" disabled={addSsh.isPending} onClick={() => addSsh.mutate()}>
                    Add SSH settings
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
                    Save host
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })}
                  >
                    Reload
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">Select a host.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
