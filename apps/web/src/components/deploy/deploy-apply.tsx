import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunLogTail } from "~/components/run-log-tail"
import { PageHeader } from "~/components/ui/page-header"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Switch } from "~/components/ui/switch"
import { Textarea } from "~/components/ui/textarea"
import { useProjectBySlug } from "~/lib/project-data"
import {
  serverUpdateApplyExecute,
  serverUpdateApplyStart,
  serverUpdateLogsExecute,
  serverUpdateLogsStart,
  serverUpdateStatusExecute,
  serverUpdateStatusStart,
} from "~/sdk/server"

type DeployApplyChangesProps = {
  projectSlug: string
  host: string
  variant?: "page" | "embedded"
}

export function DeployApplyChanges({ projectSlug, host, variant = "page" }: DeployApplyChangesProps) {
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, { projectId: projectId as Id<"projects"> }),
    enabled: Boolean(projectId),
    gcTime: 5_000,
  })
  const hostExists = Boolean(hostsQuery.data?.some((row) => row.hostName === host))

  const [targetHost, setTargetHost] = useState("")
  const expectedApplyConfirm = `apply updates ${host}`.trim()
  const [applyConfirm, setApplyConfirm] = useState("")

  const [applyRunId, setApplyRunId] = useState<Id<"runs"> | null>(null)
  const applyStart = useMutation({
    mutationFn: async () =>
      await serverUpdateApplyStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setApplyRunId(res.runId)
      void serverUpdateApplyExecute({
        data: {
          projectId: projectId as Id<"projects">,
          runId: res.runId,
          host,
          targetHost,
          confirm: applyConfirm,
        },
      })
      toast.info("Deploy apply started")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const [statusRunId, setStatusRunId] = useState<Id<"runs"> | null>(null)
  const [statusResult, setStatusResult] = useState<any>(null)
  const statusStart = useMutation({
    mutationFn: async () =>
      await serverUpdateStatusStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setStatusRunId(res.runId)
      void serverUpdateStatusExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host, targetHost },
      }).then((r) => setStatusResult(r))
      toast.info("Fetching updater status…")
    },
  })

  const [logsRunId, setLogsRunId] = useState<Id<"runs"> | null>(null)
  const [lines, setLines] = useState("200")
  const [since, setSince] = useState("")
  const [follow, setFollow] = useState(false)
  const logsStart = useMutation({
    mutationFn: async () =>
      await serverUpdateLogsStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setLogsRunId(res.runId)
      void serverUpdateLogsExecute({
        data: {
          projectId: projectId as Id<"projects">,
          runId: res.runId,
          host,
          lines,
          since,
          follow,
          targetHost,
        },
      })
      toast.info(follow ? "Following updater logs…" : "Fetching updater logs…")
    },
  })

  const body = (
    <>
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
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{host}</div>
              </div>
              <div className="space-y-2">
                <Label>Target host override (optional)</Label>
                <Input
                  value={targetHost}
                  onChange={(e) => setTargetHost(e.target.value)}
                  placeholder="admin@100.64.0.1"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={applyStart.isPending || !host || applyConfirm.trim() !== expectedApplyConfirm}
                onClick={() => applyStart.mutate()}
              >
                Apply now
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={statusStart.isPending || !host}
                onClick={() => statusStart.mutate()}
              >
                Updater status
              </Button>
              <Button
                type="button"
                disabled={logsStart.isPending || !host}
                onClick={() => logsStart.mutate()}
              >
                {follow ? "Follow logs" : "Fetch logs"}
              </Button>
              <div className="text-xs text-muted-foreground">
                Uses <code>--ssh-tty=false</code>.
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Type to confirm</Label>
                <Input
                  value={applyConfirm}
                  onChange={(e) => setApplyConfirm(e.target.value)}
                  placeholder={expectedApplyConfirm}
                />
                <div className="text-xs text-muted-foreground">
                  Expected: <code>{expectedApplyConfirm}</code>
                </div>
              </div>
            </div>
          </div>

          {statusResult?.result ? (
            <div className="rounded-lg border bg-card p-6 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Updater status</div>
              </div>
              <Textarea readOnly className="font-mono min-h-[220px]" value={JSON.stringify(statusResult.result, null, 2)} />
            </div>
          ) : null}

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="font-medium">Updater logs</div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Lines</Label>
                <Input value={lines} onChange={(e) => setLines(e.target.value)} placeholder="200" />
              </div>
              <div className="space-y-2">
                <Label>Since (optional)</Label>
                <Input value={since} onChange={(e) => setSince(e.target.value)} placeholder="1h / 5m / 2d" />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Follow</div>
                  <div className="text-xs text-muted-foreground">Streams logs until you cancel.</div>
                </div>
                <Switch checked={follow} onCheckedChange={setFollow} />
              </div>
            </div>
          </div>

          {statusRunId ? <RunLogTail runId={statusRunId} /> : null}
          {logsRunId ? <RunLogTail runId={logsRunId} /> : null}
          {applyRunId ? <RunLogTail runId={applyRunId} /> : null}
        </div>
      )}
    </>
  )

  if (variant === "embedded") {
    return <div className="space-y-6">{body}</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deploy"
        description="Apply changes to a bootstrapped host."
      />
      {body}
    </div>
  )
}
