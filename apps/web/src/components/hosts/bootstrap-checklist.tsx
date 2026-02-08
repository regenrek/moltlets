import { convexQuery } from "@convex-dev/react-query"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { toast } from "sonner"
import { Button } from "~/components/ui/button"
import { Badge } from "~/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { RunLogTail } from "~/components/run-log-tail"
import { configDotSet } from "~/sdk/config"
import { getHostPublicIpv4, probeHostTailscaleIpv4 } from "~/sdk/host"
import { serverUpdateApplyExecute, serverUpdateApplyStart } from "~/sdk/server"
import { lockdownExecute, lockdownStart } from "~/sdk/infra"
import { secretsVerifyExecute, secretsVerifyStart } from "~/sdk/secrets"

function ChecklistStep({
  title,
  statusLabel,
  statusVariant,
  description,
  actionLabel,
  actionDisabled,
  onAction,
  children,
}: {
  title: string
  statusLabel: string
  statusVariant: "secondary" | "destructive"
  description?: ReactNode
  actionLabel: string
  actionDisabled?: boolean
  onAction?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant={statusVariant}>{statusLabel}</Badge>
      </div>
      {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={actionDisabled} onClick={onAction}>
          {actionLabel}
        </Button>
        {children}
      </div>
    </div>
  )
}

export function BootstrapChecklist({
  projectId,
  host,
  config,
  hostDesired,
}: {
  projectId: Id<"projects">
  host: string
  config?: any
  hostDesired?: {
    enabled?: boolean
    targetHost?: string
    sshExposureMode?: string
    tailnetMode?: string
    selfUpdateEnabled?: boolean
    selfUpdateChannel?: string
    selfUpdateBaseUrlCount?: number
    selfUpdatePublicKeyCount?: number
    selfUpdateAllowUnsigned?: boolean
  } | null
}) {
  const queryClient = useQueryClient()
  const hostCfg = host && config?.hosts ? config.hosts[host] : null
  const metadataTargetHost = typeof hostDesired?.targetHost === "string" ? hostDesired.targetHost.trim() : ""
  const metadataSshExposure = typeof hostDesired?.sshExposureMode === "string" ? hostDesired.sshExposureMode.trim() : ""
  const metadataTailnetMode = typeof hostDesired?.tailnetMode === "string" ? hostDesired.tailnetMode.trim() : ""
  const baseTargetHost = metadataTargetHost || String(hostCfg?.targetHost || "").trim()
  const baseSshExposure = metadataSshExposure || String(hostCfg?.sshExposure?.mode || "bootstrap")
  const baseTailnetMode = metadataTailnetMode || String(hostCfg?.tailnet?.mode || "tailscale")
  const baseEnabled = typeof hostDesired?.enabled === "boolean" ? hostDesired.enabled : Boolean(hostCfg?.enable)
  const baseSelfUpdateEnabled = typeof hostDesired?.selfUpdateEnabled === "boolean"
    ? hostDesired.selfUpdateEnabled
    : Boolean(hostCfg?.selfUpdate?.enable)
  const baseSelfUpdateChannel = typeof hostDesired?.selfUpdateChannel === "string" && hostDesired.selfUpdateChannel.trim()
    ? hostDesired.selfUpdateChannel.trim()
    : String(hostCfg?.selfUpdate?.channel || "prod")
  const baseUrlsCount = typeof hostDesired?.selfUpdateBaseUrlCount === "number" && Number.isFinite(hostDesired.selfUpdateBaseUrlCount)
    ? Math.max(0, Math.trunc(hostDesired.selfUpdateBaseUrlCount))
    : Array.isArray(hostCfg?.selfUpdate?.baseUrls) ? hostCfg.selfUpdate.baseUrls.length : 0
  const publicKeysCount = typeof hostDesired?.selfUpdatePublicKeyCount === "number" && Number.isFinite(hostDesired.selfUpdatePublicKeyCount)
    ? Math.max(0, Math.trunc(hostDesired.selfUpdatePublicKeyCount))
    : Array.isArray(hostCfg?.selfUpdate?.publicKeys) ? hostCfg.selfUpdate.publicKeys.length : 0
  const baseAllowUnsigned = typeof hostDesired?.selfUpdateAllowUnsigned === "boolean"
    ? hostDesired.selfUpdateAllowUnsigned
    : Boolean(hostCfg?.selfUpdate?.allowUnsigned)
  const [targetHostOverride, setTargetHostOverride] = useState<string | null>(null)
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null)
  const [sshExposureOverride, setSshExposureOverride] = useState<string | null>(null)
  const [tailscaleIp, setTailscaleIp] = useState<string | null>(null)
  const [tailscaleError, setTailscaleError] = useState<string | null>(null)
  const [tailscaleSecretOk, setTailscaleSecretOk] = useState<boolean | null>(null)
  const [tailscaleSecretError, setTailscaleSecretError] = useState<string | null>(null)

  const [applyRunId, setApplyRunId] = useState<Id<"runs"> | null>(null)
  const [lockdownRunId, setLockdownRunId] = useState<Id<"runs"> | null>(null)
  const targetHost = targetHostOverride ?? baseTargetHost
  const sshExposure = sshExposureOverride ?? baseSshExposure
  const tailnetMode = baseTailnetMode
  const enabled = enabledOverride ?? baseEnabled
  const updateChannel = baseSelfUpdateChannel || "prod"
  const selfUpdateConfigured = baseSelfUpdateEnabled && baseUrlsCount > 0 && (baseAllowUnsigned || publicKeysCount > 0)

  useEffect(() => {
    setTargetHostOverride(null)
    setEnabledOverride(null)
    setSshExposureOverride(null)
  }, [projectId, host, baseTargetHost, baseEnabled, baseSshExposure])

  const publicIpv4Query = useQuery({
    queryKey: ["hostPublicIpv4", projectId, host],
    queryFn: async () => await getHostPublicIpv4({ data: { projectId, host } }),
    enabled: Boolean(projectId && host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const publicIpv4 = publicIpv4Query.data?.ok ? publicIpv4Query.data.ipv4 : ""
  const targetHostPublic = publicIpv4 ? `admin@${publicIpv4}` : ""
  const targetHostTailnet = tailscaleIp ? `admin@${tailscaleIp}` : ""
  const tailscaleRequired = tailnetMode === "tailscale"
  const hostsQuerySpec = convexQuery(api.controlPlane.hosts.listByProject, { projectId })

  const setConfig = useMutation({
    mutationFn: async (payload: { path: string; value?: string; valueJson?: string }) =>
      await configDotSet({ data: { projectId, path: payload.path, value: payload.value, valueJson: payload.valueJson } }),
    onSuccess: (res, payload) => {
      if (!res.ok) {
        toast.error("Config update failed")
        return
      }
      if (payload.path === `hosts.${host}.targetHost` && typeof payload.value === "string") {
        setTargetHostOverride(payload.value.trim())
      }
      if (payload.path === `hosts.${host}.enable` && typeof payload.valueJson === "string") {
        try {
          const parsed = JSON.parse(payload.valueJson)
          if (typeof parsed === "boolean") setEnabledOverride(parsed)
        } catch {
          // ignore
        }
      }
      if (payload.path === `hosts.${host}.sshExposure.mode` && typeof payload.value === "string") {
        setSshExposureOverride(payload.value.trim())
      }
      void queryClient.invalidateQueries({ queryKey: hostsQuerySpec.queryKey })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const tailscaleProbeRun = useMutation({
    mutationFn: async () => {
      if (!targetHost.trim()) throw new Error("missing targetHost")
      return await probeHostTailscaleIpv4({ data: { projectId, host, targetHost } })
    },
    onSuccess: (res) => {
      if (res.ok) {
        setTailscaleIp(res.ipv4)
        setTailscaleError(null)
      } else {
        setTailscaleIp(null)
        setTailscaleError(res.error)
      }
    },
    onError: (err) => {
      setTailscaleIp(null)
      setTailscaleError(err instanceof Error ? err.message : String(err))
    },
  })

  const tailscaleSecretCheck = useMutation({
    mutationFn: async () => {
      const start = await secretsVerifyStart({ data: { projectId, host, scope: "bootstrap" } })
      const result = await secretsVerifyExecute({ data: { projectId, runId: start.runId, host, scope: "bootstrap" } })
      return { runId: start.runId, result }
    },
    onSuccess: (_res: any) => {
      setTailscaleSecretOk(null)
      setTailscaleSecretError("verification queued; check run log and secret wiring status")
    },
    onError: (err) => {
      setTailscaleSecretOk(false)
      setTailscaleSecretError(err instanceof Error ? err.message : String(err))
    },
  })

  const applyStart = useMutation({
    mutationFn: async () => await serverUpdateApplyStart({ data: { projectId, host } }),
    onSuccess: (res) => {
      setApplyRunId(res.runId)
      void serverUpdateApplyExecute({
        data: {
          projectId,
          runId: res.runId,
          host,
          targetHost,
          confirm: `apply updates ${host}`,
        },
      })
      toast.info("Updater triggered")
    },
  })

  const lockdownStartRun = useMutation({
    mutationFn: async () => await lockdownStart({ data: { projectId, host } }),
    onSuccess: (res) => {
      setLockdownRunId(res.runId)
      void lockdownExecute({ data: { projectId, runId: res.runId, host } })
      toast.info("Lockdown started")
    },
  })

  const canSetPublicTarget = Boolean(publicIpv4)
  const canProbeTailscale = Boolean(targetHost)
  const canUseTailscale = Boolean(tailscaleIp)
  const canSwitchTailnet = tailscaleRequired ? tailscaleSecretOk === true : true
  const canLockdown = sshExposure === "tailnet" && canSwitchTailnet

  const publicStatus = useMemo(() => {
    if (publicIpv4Query.isPending) return "loading"
    return publicIpv4 ? "ok" : "missing"
  }, [publicIpv4, publicIpv4Query.isPending])

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-lg font-semibold">Post-bootstrap checklist</div>
          <div className="text-xs text-muted-foreground">Guided steps to lock down SSH safely.</div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={publicIpv4Query.isFetching}
          onClick={() => void publicIpv4Query.refetch()}
        >
          {publicIpv4Query.isFetching ? "Refreshing…" : "Refresh IP"}
        </Button>
      </div>

      {!targetHost.trim() ? (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
          <AlertTitle>targetHost required</AlertTitle>
          <AlertDescription>
            Deploys and probes fail without <code>hosts.{host}.targetHost</code>.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3">
        <ChecklistStep
          title="A. Public IPv4"
          statusLabel={publicStatus}
          statusVariant={publicStatus === "ok" ? "secondary" : "destructive"}
          description={publicIpv4 ? <code>{publicIpv4}</code> : "Fetch OpenTofu output or bootstrap logs."}
          actionLabel={`Set targetHost to admin@${publicIpv4 || "<ipv4>"}`}
          actionDisabled={!canSetPublicTarget}
          onAction={() => setConfig.mutate({ path: `hosts.${host}.targetHost`, value: targetHostPublic })}
        />

        <ChecklistStep
          title="B. Enable host"
          statusLabel={enabled ? "enabled" : "disabled"}
          statusVariant={enabled ? "secondary" : "destructive"}
          actionLabel="Enable host"
          actionDisabled={enabled}
          onAction={() => setConfig.mutate({ path: `hosts.${host}.enable`, valueJson: "true" })}
        />

        <ChecklistStep
          title="C. Apply updates (pull-only)"
          statusLabel={selfUpdateConfigured && targetHost.trim() ? "ready" : "blocked"}
          statusVariant={selfUpdateConfigured && targetHost.trim() ? "secondary" : "destructive"}
          description={
            <span>
              Channel: <code>{updateChannel}</code> · baseUrls: <code>{baseUrlsCount}</code> · Target: <code>{targetHost || "<unset>"}</code>
            </span>
          }
          actionLabel="Apply now"
          actionDisabled={!selfUpdateConfigured || !targetHost.trim()}
          onAction={() => applyStart.mutate()}
        />

        {tailscaleRequired ? (
          <ChecklistStep
            title="D. Tailscale auth key"
            statusLabel={tailscaleSecretOk ? "ok" : "missing"}
            statusVariant={tailscaleSecretOk ? "secondary" : "destructive"}
            description={tailscaleSecretError || "Required for tailnet SSH + lockdown."}
            actionLabel={tailscaleSecretCheck.isPending ? "Checking…" : "Check secrets"}
            actionDisabled={tailscaleSecretCheck.isPending}
            onAction={() => tailscaleSecretCheck.mutate()}
          />
        ) : null}

        <ChecklistStep
          title="E. Probe Tailscale IPv4"
          statusLabel={tailscaleIp ? "ok" : "blocked"}
          statusVariant={tailscaleIp ? "secondary" : "destructive"}
          description={tailscaleIp ? <code>{tailscaleIp}</code> : tailscaleError || "Requires targetHost."}
          actionLabel={tailscaleProbeRun.isPending ? "Probing…" : "Probe tailscale"}
          actionDisabled={!canProbeTailscale || tailscaleProbeRun.isPending}
          onAction={() => tailscaleProbeRun.mutate()}
        />

        <ChecklistStep
          title="F. Switch targetHost to tailnet"
          statusLabel={targetHost === targetHostTailnet ? "ok" : "pending"}
          statusVariant={targetHost === targetHostTailnet ? "secondary" : "destructive"}
          actionLabel={`Use admin@${tailscaleIp || "<tailnet-ip>"}`}
          actionDisabled={!canUseTailscale}
          onAction={() => setConfig.mutate({ path: `hosts.${host}.targetHost`, value: targetHostTailnet })}
        />

        <ChecklistStep
          title="G. Switch SSH exposure to tailnet"
          statusLabel={sshExposure === "tailnet" ? "tailnet" : sshExposure}
          statusVariant={sshExposure === "tailnet" ? "secondary" : "destructive"}
          description={canSwitchTailnet ? "Ready" : "Blocked: tailscale auth key missing"}
          actionLabel="Switch to tailnet"
          actionDisabled={!canSwitchTailnet}
          onAction={() => setConfig.mutate({ path: `hosts.${host}.sshExposure.mode`, value: "tailnet" })}
        />

        <ChecklistStep
          title="H. Run lockdown"
          statusLabel={canLockdown ? "ready" : "blocked"}
          statusVariant={canLockdown ? "secondary" : "destructive"}
          actionLabel="Run lockdown"
          actionDisabled={!canLockdown}
          onAction={() => lockdownStartRun.mutate()}
        />

        <ChecklistStep
          title="I. Re-apply updates (tailnet)"
          statusLabel={selfUpdateConfigured && targetHost.trim() ? "ready" : "blocked"}
          statusVariant={selfUpdateConfigured && targetHost.trim() ? "secondary" : "destructive"}
          actionLabel="Apply now"
          actionDisabled={!selfUpdateConfigured || !targetHost.trim()}
          onAction={() => applyStart.mutate()}
        />
      </div>

      {applyRunId ? <RunLogTail runId={applyRunId} /> : null}
      {lockdownRunId ? <RunLogTail runId={lockdownRunId} /> : null}
    </div>
  )
}
