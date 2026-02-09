import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { ArrowPathIcon, PlusIcon } from "@heroicons/react/24/outline"
import { generateHostName as generateRandomHostName } from "@clawlets/core/lib/host/host-name-generator"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { Label } from "~/components/ui/label"
import { useProjectBySlug } from "~/lib/project-data"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { addHost } from "~/sdk/config"
import { projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/hosts/")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    if (project?.status !== "ready") return
    await context.queryClient.ensureQueryData(convexQuery(api.controlPlane.hosts.listByProject, { projectId }))
  },
  component: HostsOverview,
})

function HostsOverview() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status
  const isReady = projectStatus === "ready"
  const queryClient = useQueryClient()
  const hostsQuerySpec = convexQuery(api.controlPlane.hosts.listByProject, { projectId: projectId as Id<"projects"> })
  const hostsQuery = useQuery({
    ...hostsQuerySpec,
    enabled: Boolean(projectId && isReady),
  })
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId: projectId as Id<"projects"> }),
    enabled: Boolean(projectId && isReady),
  })
  const runnerOnline = useMemo(() => isProjectRunnerOnline(runnersQuery.data ?? []), [runnersQuery.data])

  const hostRows = hostsQuery.data
  const hosts = useMemo(() => (hostRows ?? []).map((row) => row.hostName), [hostRows])
  const enabledHosts = useMemo(
    () => (hostRows ?? []).filter((row) => (row.desired?.enabled ?? true) !== false).length,
    [hostRows],
  )
  const onlineHosts = useMemo(() => (hostRows ?? []).filter((row) => row.lastStatus === "online").length, [hostRows])
  const [newHostOpen, setNewHostOpen] = useState(false)
  const [newHost, setNewHost] = useState("")

  const addHostMutation = useMutation({
    mutationFn: async () => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      const trimmed = newHost.trim()
      if (!trimmed) throw new Error("Host name required")
      if (hosts.includes(trimmed)) return { ok: true as const, queued: false as const, alreadyExists: true as const }
      return await addHost({ data: { projectId: projectId as Id<"projects">, host: trimmed } })
    },
    onSuccess: (result) => {
      if (result.queued) toast.success("Host add queued. Runner still processing.")
      else if (result.alreadyExists) toast.success("Host already exists")
      else toast.success("Host added")
      setNewHost("")
      setNewHostOpen(false)
      void queryClient.invalidateQueries({ queryKey: hostsQuerySpec.queryKey })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const onGenerateHost = () => {
    try {
      const generated = generateRandomHostName({ existingHosts: hosts })
      setNewHost(generated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }
  if (projectStatus === "creating") {
    return <div className="text-muted-foreground">Project setup in progress. Refresh after the run completes.</div>
  }
  if (projectStatus === "error") {
    return <div className="text-sm text-destructive">Project setup failed. Check Runs for details.</div>
  }

  return (
    <div className="space-y-6">
      {hostsQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : hostsQuery.error ? (
        <div className="text-sm text-destructive">{String(hostsQuery.error)}</div>
      ) : (
        <div className="space-y-6">
          <RunnerStatusBanner
            projectId={projectId as Id<"projects">}
            setupHref={`/${projectSlug}/setup/`}
            runnerOnline={runnerOnline}
            isChecking={runnersQuery.isPending}
          />
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-black tracking-tight">Hosts Overview</h1>
              <p className="text-muted-foreground">
                Fleet host summary, status, and defaults.
              </p>
            </div>
            <Dialog open={newHostOpen} onOpenChange={setNewHostOpen}>
              <Button size="sm" onClick={() => setNewHostOpen(true)}>
                <PlusIcon className="size-4" />
                New Host
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New host</DialogTitle>
                  <DialogDescription>
                    Add a host entry to your fleet config.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="new-host-name">Host name</Label>
                  <InputGroup>
                    <InputGroupInput
                      id="new-host-name"
                      placeholder="clawlets-prod-01"
                      value={newHost}
                      onChange={(e) => setNewHost(e.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        type="button"
                        variant="secondary"
                        disabled={addHostMutation.isPending}
                        onClick={onGenerateHost}
                      >
                        <ArrowPathIcon />
                        Generate
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setNewHostOpen(false)}
                  >
                    Cancel
                  </Button>
                  <AsyncButton
                    type="button"
                    disabled={addHostMutation.isPending || !newHost.trim() || !runnerOnline}
                    pending={addHostMutation.isPending}
                    pendingText="Adding host..."
                    onClick={() => addHostMutation.mutate()}
                  >
                    Add host
                  </AsyncButton>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Hosts</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {hosts.length}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Enabled</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {enabledHosts}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Online</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {onlineHosts}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3">
            {hosts.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                  No hosts configured yet.
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-xl border bg-card">
                <div className="grid grid-cols-12 gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
                  <div className="col-span-5">Name</div>
                  <div className="col-span-4">Public/Target</div>
                  <div className="col-span-2">Update ring</div>
                  <div className="col-span-1 text-right">Status</div>
                </div>
                <div className="divide-y">
                  {(hostRows ?? []).map((hostRow) => {
                    const host = hostRow.hostName
                    const enabled = (hostRow.desired?.enabled ?? true) !== false
                    const channel = String(hostRow.desired?.selfUpdateChannel || hostRow.desired?.updateRing || "prod")
                    const target = hostRow.desired?.targetHost || "—"
                    return (
                      <Link
                        key={host}
                      to="/$projectSlug/hosts/$host"
                      params={{ projectSlug, host }}
                        className="grid grid-cols-12 items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                      >
                        <div className="col-span-5 flex items-center gap-2 min-w-0">
                          <span className={enabled ? "size-2 rounded-full bg-emerald-500" : "size-2 rounded-full bg-muted-foreground/40"} />
                          <div className="font-medium truncate">{host}</div>
                        </div>
                        <div className="col-span-4 text-sm text-muted-foreground truncate">
                          {target}
                        </div>
                        <div className="col-span-2 flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="truncate">
                            {channel || "prod"}
                          </Badge>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Badge variant={enabled ? "secondary" : "outline"}>
                            {enabled ? "enabled" : "disabled"}
                          </Badge>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
