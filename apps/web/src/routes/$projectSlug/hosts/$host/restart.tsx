import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { api } from "../../../../../convex/_generated/api"
import { RunLogTail } from "~/components/run-log-tail"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { useProjectBySlug } from "~/lib/project-data"
import { serverRestartExecute, serverRestartStart } from "~/sdk/server"

export const Route = createFileRoute("/$projectSlug/hosts/$host/restart")({
  component: RestartOperate,
})

function RestartOperate() {
  const { projectSlug, host } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, { projectId: projectId as Id<"projects"> }),
    enabled: Boolean(projectId),
    gcTime: 5_000,
  })
  const hostExists = Boolean(hostsQuery.data?.some((row) => row.hostName === host))
  const gatewaysQuery = useQuery({
    ...convexQuery(api.controlPlane.gateways.listByProjectHost, {
      projectId: projectId as Id<"projects">,
      hostName: host,
    }),
    enabled: Boolean(projectId) && hostExists,
    gcTime: 5_000,
  })
  const gateways = useMemo(() => (gatewaysQuery.data || []).map((row) => row.gatewayId), [gatewaysQuery.data])

  const [unit, setUnit] = useState("openclaw-*.service")
  const [targetHost, setTargetHost] = useState("")

  const expectedConfirm = `restart ${unit.trim() || "openclaw-*.service"}`.trim()
  const [confirm, setConfirm] = useState("")

  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const start = useMutation({
    mutationFn: async () =>
      await serverRestartStart({ data: { projectId: projectId as Id<"projects">, host, unit } }),
    onSuccess: (res) => {
      setRunId(res.runId)
      void serverRestartExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host, unit, targetHost, confirm },
      })
      toast.info("Restart started")
    },
  })

  const canRestart = Boolean(host && confirm.trim() === expectedConfirm)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Restart</h1>
      <p className="text-muted-foreground">
        Restart services with typed confirmations and RBAC.
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
      ) : !hostExists ? (
        <div className="text-muted-foreground">Host not found in control-plane metadata.</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Host</Label>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {host || "No hosts configured"}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <NativeSelect value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <NativeSelectOption value="openclaw-*.service">openclaw-*.service</NativeSelectOption>
                  {gateways.map((gatewayId) => (
                    <NativeSelectOption key={gatewayId} value={`openclaw-${gatewayId}.service`}>
                      openclaw-{gatewayId}.service
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Target host override (optional)</Label>
              <Input value={targetHost} onChange={(e) => setTargetHost(e.target.value)} placeholder="admin@100.64.0.1" />
            </div>

            <div className="space-y-2">
              <Label>Type to confirm</Label>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={expectedConfirm} />
              <div className="text-xs text-muted-foreground">
                Expected: <code>{expectedConfirm}</code>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <AsyncButton
                type="button"
                disabled={start.isPending || !canRestart}
                pending={start.isPending}
                pendingText="Restarting..."
                onClick={() => start.mutate()}
              >
                Restart
              </AsyncButton>
              <div className="text-xs text-muted-foreground">
                Uses <code>--ssh-tty=false</code>.
              </div>
            </div>
          </div>

          {runId ? <RunLogTail runId={runId} /> : null}
        </div>
      )}
    </div>
  )
}
