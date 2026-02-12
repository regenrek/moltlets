import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { dashboardOverviewQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"
import { projectImport } from "~/sdk/project"
import { toast } from "sonner"

function shellQuote(value: string): string {
  if (!value) return "''"
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function shellQuotePath(value: string): string {
  const trimmed = String(value || "").trim()
  if (!trimmed) return "''"
  if (trimmed === "~") return "\"$HOME\""
  if (trimmed.startsWith("~/")) {
    return `"${"$HOME"}"${shellQuote(trimmed.slice(1))}`
  }
  return shellQuote(trimmed)
}

async function copyText(label: string, value: string): Promise<void> {
  if (!value.trim()) {
    toast.error(`${label} is empty`)
    return
  }
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    toast.error("Clipboard unavailable")
    return
  }
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  } catch {
    toast.error("Copy failed")
  }
}

export const Route = createFileRoute("/projects/import")({
  component: ImportProject,
})

function ImportProject() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [repoUrl, setRepoUrl] = useState("")
  const [runnerRepoPathInput, setRunnerRepoPathInput] = useState("")
  const [runnerNameInput, setRunnerNameInput] = useState("")
  const [branch, setBranch] = useState("")
  const [depth, setDepth] = useState("")
  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null)
  const [runnerToken, setRunnerToken] = useState("")
  const [runnerRepoPathResolved, setRunnerRepoPathResolved] = useState("")
  const [runnerNameResolved, setRunnerNameResolved] = useState("")
  const [redirected, setRedirected] = useState(false)

  const nameSlug = useMemo(() => slugifyProjectName(name || "project"), [name])
  const defaultRunnerRepoPath = `~/.clawlets/projects/${nameSlug}`
  const defaultRunnerName = `runner-${nameSlug || "project"}`
  const effectiveRunnerRepoPath = (runnerRepoPathInput.trim() || defaultRunnerRepoPath).replace(/\/+$/, "") || "/"
  const effectiveRunnerName = runnerNameInput.trim() || defaultRunnerName
  const dashboardOverviewQueryKey = dashboardOverviewQueryOptions().queryKey
  const controlPlaneUrl = String(import.meta.env.VITE_CONVEX_SITE_URL || "").trim()
  const runnerStartCommand = useMemo(() => {
    const repoRoot = runnerRepoPathResolved || effectiveRunnerRepoPath
    const runnerName = runnerNameResolved || effectiveRunnerName
    const token = runnerToken || "<runner-token>"
    const repoRootArg = repoRoot ? shellQuotePath(repoRoot) : shellQuote("<runner-repo-root>")
    const lines: string[] = []
    lines.push(`mkdir -p ${repoRootArg}`)
    lines.push("clawlets runner start \\")
    lines.push(`  --project ${projectId || "<project-id>"} \\`)
    lines.push(`  --name ${shellQuote(runnerName)} \\`)
    lines.push(`  --token ${shellQuote(token)} \\`)
    lines.push(`  --repoRoot ${repoRootArg} \\`)
    lines.push(`  --control-plane-url ${shellQuote(controlPlaneUrl || "<convex-site-url>")}`)
    return lines.join("\n")
  }, [controlPlaneUrl, effectiveRunnerName, effectiveRunnerRepoPath, projectId, runnerNameResolved, runnerRepoPathResolved, runnerToken])

  const importMutation = useMutation({
    mutationFn: async () =>
      await projectImport({
        data: {
          name,
          repoUrl,
          runnerRepoPath: effectiveRunnerRepoPath,
          runnerName: effectiveRunnerName,
          branch: branch.trim(),
          depth: depth.trim(),
        },
      }),
    onSuccess: (res) => {
      setRunId(res.runId)
      setProjectId(res.projectId)
      setRunnerToken(String(res.token || ""))
      setRunnerRepoPathResolved(String(res.runnerRepoPath || effectiveRunnerRepoPath))
      setRunnerNameResolved(String(res.runnerName || effectiveRunnerName))
      setRedirected(false)
      void queryClient.invalidateQueries({ queryKey: dashboardOverviewQueryKey })
    },
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Import Project</h1>
        <p className="text-muted-foreground mt-1">
          Queue remote git clone on a runner host.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Project name</Label>
          <Input
            id="name"
            placeholder="my-existing-fleet"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="repo">Git repo URL</Label>
          <Input
            id="repo"
            placeholder="git@github.com:owner/repo.git"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="runner-path">Runner repo path</Label>
          <Input
            id="runner-path"
            placeholder={defaultRunnerRepoPath}
            value={runnerRepoPathInput}
            onChange={(e) => setRunnerRepoPathInput(e.target.value)}
          />
          <div className="text-muted-foreground text-xs">
            Default: <code>{defaultRunnerRepoPath}</code>.
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="runner-name">Runner name</Label>
          <Input
            id="runner-name"
            placeholder={defaultRunnerName}
            value={runnerNameInput}
            onChange={(e) => setRunnerNameInput(e.target.value)}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="branch">Branch (optional)</Label>
            <Input
              id="branch"
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="depth">Depth (optional)</Label>
            <Input
              id="depth"
              placeholder="1"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AsyncButton
            type="button"
            disabled={importMutation.isPending || !name.trim() || !repoUrl.trim() || !effectiveRunnerRepoPath.trim() || !effectiveRunnerName.trim()}
            pending={importMutation.isPending}
            pendingText="Queueing import..."
            onClick={() => importMutation.mutate()}
          >
            Import
          </AsyncButton>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link to="/projects" />}
          >
            Cancel
          </Button>
        </div>

        {projectId && runId ? (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="text-sm font-medium">Runner token</div>
            <pre className="rounded-md border bg-background p-2 text-xs break-all">{runnerToken}</pre>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void copyText("Runner token", runnerToken)}>
                Copy token
              </Button>
            </div>
            <div className="pt-2">
              <div className="mb-2 text-sm font-medium">Runner start command</div>
              <pre className="rounded-md border bg-background p-2 text-xs whitespace-pre-wrap break-words">{runnerStartCommand}</pre>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void copyText("Runner command", runnerStartCommand)}>
                  Copy command
                </Button>
                <span className="text-xs text-muted-foreground">Run on the runner host. Job starts after heartbeat.</span>
              </div>
            </div>
          </div>
        ) : null}

        {projectId && runId ? (
          <div className="space-y-3">
            <RunLogTail
              runId={runId}
              onDone={(status) => {
                if (redirected) return
                if (status !== "succeeded") return
                setRedirected(true)
                void queryClient.invalidateQueries({ queryKey: dashboardOverviewQueryKey })
                void router.navigate({
                  to: "/$projectSlug",
                  params: { projectSlug: nameSlug },
                } as any)
              }}
            />
            <div className="text-xs text-muted-foreground">
              If runner is offline, run remains queued and project stays <code>creating</code>.
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void router.navigate({
                    to: "/$projectSlug/runs",
                    params: { projectSlug: nameSlug },
                  } as any)
                }}
              >
                Open runs
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void router.navigate({
                    to: "/$projectSlug",
                    params: { projectSlug: nameSlug },
                  } as any)
                }}
              >
                Open project
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
