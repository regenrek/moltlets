import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunLogTail } from "~/components/run-log-tail"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { SettingsSection } from "~/components/ui/settings-section"
import { TailscaleAuthKeyCard } from "~/components/hosts/tailscale-auth-key-card"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { configDotSet } from "~/sdk/config"
import { getHostPublicIpv4, probeHostTailscaleIpv4 } from "~/sdk/host"
import { lockdownExecute, lockdownStart } from "~/sdk/infra"
import { serverUpdateApplyExecute, serverUpdateApplyStart } from "~/sdk/server"

type SshExposureMode = "tailnet" | "bootstrap" | "public"
type TailnetMode = "tailscale" | "none"
const TAILSCALE_SECRET_NAME = "tailscale_auth_key"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asTailnetMode(value: unknown): TailnetMode {
  return value === "none" ? "none" : "tailscale"
}

function asSshExposureMode(value: unknown): SshExposureMode {
  return value === "tailnet" || value === "public" ? value : "bootstrap"
}

function formatValidationIssues(issues: unknown): string {
  if (!Array.isArray(issues)) return "Validation failed"
  const first = asRecord(issues[0])
  const message = typeof first?.message === "string" ? first.message : "Validation failed"
  const pathSegments = Array.isArray(first?.path) ? first.path.map(String).filter(Boolean) : []
  return pathSegments.length > 0 ? `${message} (${pathSegments.join(".")})` : message
}

export function HostSettingsVpnPanel(props: {
  projectId: Id<"projects">
  projectSlug: string
  host: string
  hostCfg: Record<string, unknown>
  hostConfigQueryKey: readonly unknown[]
}) {
  const queryClient = useQueryClient()
  const tailnetCfg = asRecord(props.hostCfg.tailnet) ?? {}
  const sshExposureCfg = asRecord(props.hostCfg.sshExposure) ?? {}
  const [tailnetMode, setTailnetMode] = useState<TailnetMode>(asTailnetMode(tailnetCfg.mode))
  const [sshExposure, setSshExposure] = useState<SshExposureMode>(asSshExposureMode(sshExposureCfg.mode))
  const [targetHost, setTargetHost] = useState(asString(props.hostCfg.targetHost))
  const [activateError, setActivateError] = useState<string | null>(null)
  const [lockdownRunId, setLockdownRunId] = useState<Id<"runs"> | null>(null)
  const [applyRunId, setApplyRunId] = useState<Id<"runs"> | null>(null)

  const publicIpv4Query = useQuery({
    queryKey: ["hostPublicIpv4", props.projectId, props.host],
    queryFn: async () => await getHostPublicIpv4({ data: { projectId: props.projectId, host: props.host } }),
    enabled: Boolean(props.projectId && props.host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const wiringQueryOptions = convexQuery(api.controlPlane.secretWiring.listByProjectHost, {
    projectId: props.projectId,
    hostName: props.host,
  })
  const wiringQuery = useQuery({
    ...wiringQueryOptions,
    enabled: Boolean(props.projectId && props.host),
  })
  const hasHostTailscaleAuthKey = (wiringQuery.data ?? []).some(
    (row) => row.secretName === TAILSCALE_SECRET_NAME && row.status === "configured",
  )

  async function requireConfigSet(params: { path: string; value?: string; valueJson?: string }): Promise<void> {
    const result = await configDotSet({
      data: {
        projectId: props.projectId,
        path: params.path,
        value: params.value,
        valueJson: params.valueJson,
      },
    })
    if (result.ok) return
    throw new Error(formatValidationIssues(result.issues))
  }

  const saveVpnSettings = useMutation({
    mutationFn: async () => {
      await requireConfigSet({
        path: `hosts.${props.host}.tailnet.mode`,
        value: tailnetMode,
      })
      await requireConfigSet({
        path: `hosts.${props.host}.sshExposure.mode`,
        value: sshExposure,
      })
      const nextTargetHost = targetHost.trim()
      if (nextTargetHost) {
        await requireConfigSet({
          path: `hosts.${props.host}.targetHost`,
          value: nextTargetHost,
        })
      }
      return { nextTargetHost }
    },
    onSuccess: () => {
      toast.success("VPN settings saved")
      void queryClient.invalidateQueries({ queryKey: props.hostConfigQueryKey })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    },
  })

  const activateTailnet = useMutation({
    mutationFn: async () => {
      if (!props.host.trim()) throw new Error("Host is required")
      if (!hasHostTailscaleAuthKey) throw new Error("Missing required tailscale_auth_key. Configure it in Host Secrets first.")
      setActivateError(null)

      await requireConfigSet({
        path: `hosts.${props.host}.tailnet.mode`,
        value: "tailscale",
      })

      let nextTargetHost = targetHost.trim()
      if (!nextTargetHost) {
        const publicIp = await getHostPublicIpv4({
          data: { projectId: props.projectId, host: props.host },
        })
        if (!publicIp.ok) throw new Error(publicIp.error || "Could not resolve public IPv4 for targetHost")
        if (!publicIp.ipv4) throw new Error("Could not resolve public IPv4 for targetHost")
        nextTargetHost = `admin@${publicIp.ipv4}`
        await requireConfigSet({
          path: `hosts.${props.host}.targetHost`,
          value: nextTargetHost,
        })
      }

      const probe = await probeHostTailscaleIpv4({
        data: { projectId: props.projectId, host: props.host, targetHost: nextTargetHost },
      })
      if (!probe.ok) throw new Error(probe.error || "Could not resolve Tailscale IPv4")
      if (!probe.ipv4) throw new Error("Could not resolve Tailscale IPv4")

      nextTargetHost = `admin@${probe.ipv4}`
      await requireConfigSet({
        path: `hosts.${props.host}.targetHost`,
        value: nextTargetHost,
      })
      await requireConfigSet({
        path: `hosts.${props.host}.sshExposure.mode`,
        value: "tailnet",
      })

      const lockdown = await lockdownStart({
        data: { projectId: props.projectId, host: props.host },
      })
      setLockdownRunId(lockdown.runId)
      await lockdownExecute({
        data: { projectId: props.projectId, runId: lockdown.runId, host: props.host },
      })

      const apply = await serverUpdateApplyStart({
        data: { projectId: props.projectId, host: props.host },
      })
      setApplyRunId(apply.runId)
      await serverUpdateApplyExecute({
        data: {
          projectId: props.projectId,
          runId: apply.runId,
          host: props.host,
          targetHost: nextTargetHost,
          confirm: `apply updates ${props.host}`,
        },
      })
      return { targetHost: nextTargetHost }
    },
    onSuccess: (result) => {
      setTailnetMode("tailscale")
      setSshExposure("tailnet")
      setTargetHost(result.targetHost)
      toast.success("Tailnet activation + lockdown queued")
      void queryClient.invalidateQueries({ queryKey: props.hostConfigQueryKey })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      setActivateError(message)
      toast.error(message)
    },
  })

  const publicIpv4 = publicIpv4Query.data?.ok ? publicIpv4Query.data.ipv4 : ""
  const publicIpv4Error = publicIpv4Query.data && !publicIpv4Query.data.ok
    ? publicIpv4Query.data.error
    : ""
  const showSshWarning = sshExposure === "bootstrap" || sshExposure === "public"

  return (
    <div className="space-y-4">
      <SettingsSection
        title="VPN / Tailscale"
        description="Control tailnet mode and run one-shot SSH lockdown automation."
        statusText={tailnetMode === "tailscale" ? "Tailnet mode enabled" : "Tailnet mode disabled"}
        actions={
          <AsyncButton
            type="button"
            disabled={saveVpnSettings.isPending}
            pending={saveVpnSettings.isPending}
            pendingText="Saving..."
            onClick={() => saveVpnSettings.mutate()}
          >
            Save settings
          </AsyncButton>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <LabelWithHelp htmlFor="vpnTailnetMode" help={setupFieldHelp.hosts.tailnet}>
              Tailnet mode
            </LabelWithHelp>
            <NativeSelect
              id="vpnTailnetMode"
              value={tailnetMode}
              onChange={(event) => setTailnetMode(asTailnetMode(event.target.value))}
            >
              <NativeSelectOption value="tailscale">tailscale</NativeSelectOption>
              <NativeSelectOption value="none">none</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <LabelWithHelp htmlFor="vpnSshExposure" help={setupFieldHelp.hosts.sshExposure}>
              SSH exposure
            </LabelWithHelp>
            <NativeSelect
              id="vpnSshExposure"
              value={sshExposure}
              onChange={(event) => setSshExposure(asSshExposureMode(event.target.value))}
            >
              <NativeSelectOption value="tailnet">tailnet</NativeSelectOption>
              <NativeSelectOption value="bootstrap">bootstrap</NativeSelectOption>
              <NativeSelectOption value="public">public</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>

        <div className="space-y-2">
          <LabelWithHelp htmlFor="vpnTargetHost" help={setupFieldHelp.hosts.targetHost}>
            SSH targetHost
          </LabelWithHelp>
          <Input
            id="vpnTargetHost"
            value={targetHost}
            onChange={(event) => setTargetHost(event.target.value)}
            placeholder="admin@100.64.0.1"
          />
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
          <div className="font-medium">Public IPv4 helper</div>
          {publicIpv4Query.isPending ? (
            <div className="text-muted-foreground">Resolving public IPv4…</div>
          ) : publicIpv4 ? (
            <div className="flex flex-wrap items-center gap-2">
              <code>{publicIpv4}</code>
              <AsyncButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setTargetHost(`admin@${publicIpv4}`)}
              >
                Use `admin@{publicIpv4}`
              </AsyncButton>
            </div>
          ) : (
            <div className="text-muted-foreground">{publicIpv4Error || "No IPv4 found"}</div>
          )}
        </div>

        {tailnetMode === "tailscale" && !hasHostTailscaleAuthKey ? (
          <Alert variant="destructive">
            <AlertTitle>Tailscale auth key missing</AlertTitle>
            <AlertDescription>
              Configure <code>tailscale_auth_key</code> for this host before activation.{" "}
              <Link
                className="underline underline-offset-4 hover:text-foreground"
                to="/$projectSlug/hosts/$host/secrets"
                params={{ projectSlug: props.projectSlug, host: props.host }}
              >
                Open Host Secrets
              </Link>
              .
            </AlertDescription>
          </Alert>
        ) : null}

        {tailnetMode === "none" ? (
          <Alert
            variant="default"
            className="border-amber-300/50 bg-amber-50/50 text-amber-900 [&_[data-slot=alert-description]]:text-amber-900/90"
          >
            <AlertTitle>VPN disabled</AlertTitle>
            <AlertDescription>
              Host remains SSH-only. This is supported, but less secure than tailnet lockdown.
            </AlertDescription>
          </Alert>
        ) : null}

        {showSshWarning ? (
          <Alert variant="destructive">
            <AlertTitle>Public SSH exposure detected</AlertTitle>
            <AlertDescription>
              SSH exposure is <code>{sshExposure}</code>. Run activation to switch to tailnet and queue lockdown.
            </AlertDescription>
          </Alert>
        ) : null}

        {activateError ? (
          <Alert variant="destructive">
            <AlertTitle>Activation failed</AlertTitle>
            <AlertDescription>{activateError}</AlertDescription>
          </Alert>
        ) : null}
      </SettingsSection>

      {tailnetMode === "tailscale" ? (
        <TailscaleAuthKeyCard
          projectId={props.projectId}
          projectSlug={props.projectSlug}
          host={props.host}
        />
      ) : null}

      <SettingsSection
        title="Activate Tailnet"
        description="Adds tailnet target host, switches SSH exposure, runs lockdown, then applies updates."
        actions={
          <AsyncButton
            type="button"
            disabled={activateTailnet.isPending}
            pending={activateTailnet.isPending}
            pendingText="Activating..."
            onClick={() => activateTailnet.mutate()}
          >
            Activate + Lockdown
          </AsyncButton>
        }
      >
        <div className="text-sm text-muted-foreground">
          This action automates: probe Tailscale IP, set <code>targetHost</code>, switch SSH exposure to <code>tailnet</code>, run <code>lockdown</code>, and re-apply updates.
        </div>
      </SettingsSection>

      {lockdownRunId ? <RunLogTail runId={lockdownRunId} /> : null}
      {applyRunId ? <RunLogTail runId={applyRunId} /> : null}
    </div>
  )
}
