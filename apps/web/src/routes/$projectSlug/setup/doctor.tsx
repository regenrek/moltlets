import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { RunLogTail } from "~/components/run-log-tail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { useProjectBySlug } from "~/lib/project-data"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { runDoctor } from "~/sdk/infra"

export const Route = createFileRoute("/$projectSlug/setup/doctor")({
  component: DoctorSetup,
})

function pickFixLink(
  projectSlug: string,
  host: string | null,
  check: any,
): { to: string; label: string } | null {
  const rawLabel = String(check?.label || "")
  const label = rawLabel.toLowerCase()
  const detail = String(check?.detail || "")
  const scope = String(check?.scope || "")
  const base = `/${projectSlug}`
  const hostBase = host ? `${base}/hosts/${encodeURIComponent(host)}` : null

  const toFleet = () => ({ to: `${base}/setup/fleet`, label: "Open Skills" })
  const toHosts = () => ({ to: `${base}/hosts`, label: "Open Hosts" })
  const toProjectSecrets = () => ({ to: `${base}/api-keys`, label: "Open API Keys" })
  const toHostSecrets = () => hostBase
    ? ({ to: `${hostBase}/secrets`, label: "Open Host Secrets" })
    : toHosts()
  const toDeploy = () => hostBase
    ? ({ to: `${hostBase}/deploy`, label: "Open Deploy" })
    : toHosts()
  const toAudit = () => hostBase
    ? ({ to: `${hostBase}/audit`, label: "Open Audit" })
    : toHosts()
  const toGatewaySettings = (gatewayId: string) => hostBase
    ? ({ to: `${hostBase}/gateways/${encodeURIComponent(gatewayId)}/settings`, label: "Open Gateway Settings" })
    : toHosts()

  const gatewayFromLabel = () => {
    const match = rawLabel.match(/\(([^)]+)\)/)
    return match?.[1]?.trim() || ""
  }
  const gatewayFromDetail = () => {
    const match = detail.match(/hosts\.[a-z0-9_-]+\.gateways\.([a-z0-9_-]+)/i)
    return match?.[1]?.trim() || ""
  }
  const gatewayId = gatewayFromLabel() || gatewayFromDetail()

  if (label.includes("clawlets config") || label.includes("fleet config")) return toFleet()
  if (label.includes("fleet policy") || label.includes("fleet gateways") || label.includes("services.openclawfleet.enable")) return toFleet()
  if (label.includes("host config") || label.includes("targethost") || label.includes("sshexposure") || label.includes("diskdevice")) return toHosts()
  if (label.includes("provisioning") || label.includes("admin cidr") || label.includes("ssh pubkey")) return toHosts()
  if (label.includes("hcloud_token") || label.includes("github_token") || label.includes("sops_age_key_file")) return toProjectSecrets()
  if (label.includes("sops") || label.includes("secrets")) return toHostSecrets()
  if (gatewayId && label.includes("openclaw security")) return toGatewaySettings(gatewayId)
  if (gatewayId && detail.includes("hosts.") && detail.includes(".gateways.")) return toGatewaySettings(gatewayId)
  if (scope === "updates") return toDeploy()
  if (label.includes("tailscale")) return toAudit()
  return null
}

function DoctorSetup() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const hostsQuery = useQuery({
    ...convexQuery(api.hosts.listByProject, { projectId: projectId as Id<"projects"> }),
    enabled: Boolean(projectId),
    gcTime: 5_000,
  })
  const hosts = useMemo(
    () => (hostsQuery.data || []).map((row) => row.hostName).sort((a, b) => a.localeCompare(b)),
    [hostsQuery.data],
  )
  const [host, setHost] = useState("")
  useEffect(() => {
    if (hosts.length === 0) return
    setHost((prev) => {
      if (prev && hosts.includes(prev)) return prev
      return hosts[0] || ""
    })
  }, [hosts])
  const [scope, setScope] = useState<"repo" | "bootstrap" | "updates" | "cattle" | "all">("all")
  const [result, setResult] = useState<null | { runId: Id<"runs">; checks: any[]; ok: boolean }>(null)

  const run = useMutation({
    mutationFn: async () => {
      if (!host) throw new Error("missing host")
      return await runDoctor({
        data: {
          projectId: projectId as Id<"projects">,
          host,
          scope,
        },
      })
    },
    onSuccess: (res) => {
      setResult(res as any)
      toast.success(res.ok ? "Doctor ok" : "Doctor found issues")
    },
  })

  const summary = useMemo(() => {
    const checks = result?.checks || []
    const counts = { ok: 0, warn: 0, missing: 0 }
    for (const c of checks) {
      if (c.status === "ok") counts.ok++
      else if (c.status === "warn") counts.warn++
      else counts.missing++
    }
    return counts
  }, [result])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Doctor</h1>
      <p className="text-muted-foreground">
        Validate repo, config, and update readiness.
      </p>

      {projectQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : projectQuery.error ? (
        <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
      ) : !projectId ? (
        <div className="text-muted-foreground">Project not found.</div>
      ) : hostsQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : hostsQuery.error ? (
        <div className="text-sm text-destructive">{String(hostsQuery.error)}</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithHelp help={setupFieldHelp.doctor.host}>
                  Host
                </LabelWithHelp>
                {hosts.length === 0 ? (
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    No hosts configured
                  </div>
                ) : (
                  <NativeSelect
                    id="doctorHost"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  >
                    {hosts.map((name) => (
                      <NativeSelectOption key={name} value={name}>
                        {name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </div>
              <div className="space-y-2">
                <LabelWithHelp htmlFor="doctorScope" help={setupFieldHelp.doctor.scope}>
                  Scope
                </LabelWithHelp>
                <NativeSelect id="doctorScope" value={scope} onChange={(e) => setScope(e.target.value as any)}>
                  <NativeSelectOption value="all">all</NativeSelectOption>
                  <NativeSelectOption value="repo">repo</NativeSelectOption>
                  <NativeSelectOption value="bootstrap">bootstrap</NativeSelectOption>
                  <NativeSelectOption value="updates">updates</NativeSelectOption>
                  <NativeSelectOption value="cattle">cattle</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
            <Button type="button" disabled={run.isPending || !host} onClick={() => run.mutate()}>
              Run doctor
            </Button>
          </div>

          {result ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">ok: {summary.ok}</Badge>
                <Badge variant="secondary">warn: {summary.warn}</Badge>
                <Badge variant="destructive">missing: {summary.missing}</Badge>
              </div>

              <div className="rounded-lg border bg-card p-6 space-y-3">
                <div className="font-medium">Report</div>
                <div className="grid gap-2">
                  {result.checks.map((c: any, idx: number) => {
                    const fix = pickFixLink(projectSlug, host || null, c)
                    return (
                      <div key={`${idx}-${c.label}`} className="flex items-start justify-between gap-3 border-b last:border-b-0 pb-2 last:pb-0">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{c.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.scope}
                            {c.detail ? ` · ${c.detail}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {fix ? (
                            <Button
                              size="sm"
                              variant="outline"
                              nativeButton={false}
                              render={<Link to={fix.to} />}
                            >
                              {fix.label}
                            </Button>
                          ) : null}
                          <Badge variant={c.status === "missing" ? "destructive" : "secondary"}>
                            {c.status}
                          </Badge>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <RunLogTail runId={result.runId} />
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
