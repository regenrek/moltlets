import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunLogTail } from "~/components/run-log-tail"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { BootstrapChecklist } from "~/components/hosts/bootstrap-checklist"
import { BootstrapDeploySourceSection } from "~/components/hosts/bootstrap-deploy-source"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { HelpTooltip, LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { Switch } from "~/components/ui/switch"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog"
import { canBootstrapFromDoctorGate } from "~/lib/bootstrap-gate"
import { useProjectBySlug } from "~/lib/project-data"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { gitPushExecute, gitRepoStatus } from "~/sdk/vcs"
import { bootstrapExecute, bootstrapStart, runDoctor } from "~/sdk/infra"
import { DeployInitialInstallSetup } from "~/components/deploy/deploy-initial-setup"
import type { SetupDraftConnection, SetupDraftInfrastructure, SetupDraftView } from "~/sdk/setup"

type SetupPendingBootstrapSecrets = {
  adminPassword: string
  tailscaleAuthKey: string
  useTailscaleLockdown: boolean
}

type DeployInitialInstallProps = {
  projectSlug: string
  host: string
  variant?: "page" | "embedded" | "setup"
  hasBootstrapped?: boolean
  onBootstrapped?: () => void
  headerBadge?: ReactNode
  setupDraft?: SetupDraftView | null
  pendingInfrastructureDraft?: SetupDraftInfrastructure | null
  pendingConnectionDraft?: SetupDraftConnection | null
  pendingBootstrapSecrets?: SetupPendingBootstrapSecrets
}

export function DeployInitialInstall({
  projectSlug,
  host,
  variant = "page",
  hasBootstrapped = false,
  onBootstrapped,
  headerBadge,
  setupDraft = null,
  pendingInfrastructureDraft = null,
  pendingConnectionDraft = null,
  pendingBootstrapSecrets = {
    adminPassword: "",
    tailscaleAuthKey: "",
    useTailscaleLockdown: true,
  },
}: DeployInitialInstallProps) {
  if (variant === "setup") {
    return (
      <DeployInitialInstallSetup
        projectSlug={projectSlug}
        host={host}
        hasBootstrapped={hasBootstrapped}
        onContinue={onBootstrapped}
        headerBadge={headerBadge}
        setupDraft={setupDraft}
        pendingInfrastructureDraft={pendingInfrastructureDraft}
        pendingConnectionDraft={pendingConnectionDraft}
        pendingBootstrapSecrets={pendingBootstrapSecrets}
      />
    )
  }

  return (
    <DeployInitialInstallDefault
      projectSlug={projectSlug}
      host={host}
      variant={variant}
      onBootstrapped={onBootstrapped}
    />
  )
}

function DeployInitialInstallDefault({
  projectSlug,
  host,
  variant = "page",
  onBootstrapped,
}: Omit<DeployInitialInstallProps, "hasBootstrapped">) {
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, projectId ? { projectId } : "skip"),
    gcTime: 5_000,
  })
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, projectId ? { projectId } : "skip"),
    gcTime: 5_000,
  })
  const runnerOnline = useMemo(() => isProjectRunnerOnline(runnersQuery.data ?? []), [runnersQuery.data])
  const hostSummary = hostsQuery.data?.find((row) => row.hostName === host) ?? null
  const tailnetMode = String(hostSummary?.desired?.tailnetMode || "none")
  const [mode, setMode] = useState<"nixos-anywhere" | "image">("nixos-anywhere")
  const [force, setForce] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [deploySource, setDeploySource] = useState<"local" | "remote">("remote")
  const [lockdownAfterByHost, setLockdownAfterByHost] = useState<Record<string, boolean>>({})

  const [doctor, setDoctor] = useState<null | { ok: boolean; checks: any[]; runId: Id<"runs"> }>(null)

  const repoStatus = useQuery({
    queryKey: ["gitRepoStatus", projectId],
    queryFn: async () =>
      await gitRepoStatus({ data: { projectId: projectId as Id<"projects"> } }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(projectId && runnerOnline),
  })

  const pushNow = useMutation({
    mutationFn: async () => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      return await gitPushExecute({ data: { projectId: projectId as Id<"projects"> } })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.info("Git push queued")
        void repoStatus.refetch()
      } else {
        toast.error("git push failed (see Runs for logs)")
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const doctorRun = useMutation({
    mutationFn: async () => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      return await runDoctor({
        data: { projectId: projectId as Id<"projects">, host, scope: "bootstrap" },
      })
    },
    onSuccess: (res) => {
      setDoctor(res as any)
      toast.info(res.ok ? "Doctor ok" : "Doctor found issues")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const start = useMutation({
    mutationFn: async () => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      return await bootstrapStart({ data: { projectId: projectId as Id<"projects">, host, mode } })
    },
    onSuccess: (res) => {
      setRunId(res.runId)
      void bootstrapExecute({
        data: {
          projectId: projectId as Id<"projects">,
          runId: res.runId,
          host,
          mode,
          force,
          dryRun,
          lockdownAfter,
          rev: mode === "nixos-anywhere" ? selectedRev : undefined,
        },
      })
      toast.info("Initial install started")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const requiresFlake = mode === "nixos-anywhere"
  const repo = repoStatus.data
  const localSelected = deploySource === "local"
  const selectedRev = requiresFlake ? (localSelected ? repo?.localHead : repo?.originHead) : null
  const missingRev = requiresFlake && (localSelected ? !repo?.localHead : !repo?.originHead)
  const needsPush = requiresFlake && localSelected && Boolean(repo?.needsPush)
  const pushBlocked = needsPush && !repo?.canPush
  const repoGateBlocked = requiresFlake
    && (repoStatus.isPending || missingRev || needsPush || pushBlocked || Boolean(repoStatus.error))

  const canAutoLockdown = mode === "nixos-anywhere" && tailnetMode === "tailscale"
  const lockdownAfterRequested = host
    ? (Object.prototype.hasOwnProperty.call(lockdownAfterByHost, host)
      ? Boolean(lockdownAfterByHost[host])
      : tailnetMode === "tailscale")
    : false
  const lockdownAfter = canAutoLockdown && lockdownAfterRequested

  const doctorGateOk = canBootstrapFromDoctorGate({ host, force, doctor })
  const canBootstrap = runnerOnline && doctorGateOk && !repoGateBlocked
  const cliCmd = useMemo(() => {
    if (!host) return ""
    const parts = ["clawlets", "bootstrap", "--host", host, "--mode", mode]
    if (selectedRev) parts.push("--rev", selectedRev)
    if (lockdownAfter) parts.push("--lockdown-after")
    if (force) parts.push("--force")
    if (dryRun) parts.push("--dry-run")
    return parts.join(" ")
  }, [dryRun, force, host, lockdownAfter, mode, selectedRev])

  const formatSha = (sha?: string | null) => (sha ? sha.slice(0, 7) : "unknown")

  const content = (
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
      ) : (
        <div className="space-y-6">
          <RunnerStatusBanner
            projectId={projectId as Id<"projects">}
            setupHref={`/${projectSlug}/hosts/${host}/setup`}
            runnerOnline={runnerOnline}
            isChecking={runnersQuery.isPending}
          />
          {!hostSummary ? (
            <div className="rounded-md border border-amber-300/40 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
              Host metadata not synced yet. Showing defaults until runner sync.
            </div>
          ) : null}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithHelp help={setupFieldHelp.bootstrap.host}>
                  Host
                </LabelWithHelp>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {host || "No hosts configured"}
                </div>
              </div>
              <div className="space-y-2">
                <LabelWithHelp htmlFor="bootstrapMode" help={setupFieldHelp.bootstrap.mode}>
                  Mode
                </LabelWithHelp>
                <NativeSelect id="bootstrapMode" value={mode} onChange={(e) => setMode(e.target.value as any)}>
                  <NativeSelectOption value="nixos-anywhere">nixos-anywhere</NativeSelectOption>
                  <NativeSelectOption value="image">image</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>

            <div className="space-y-2">
              <BootstrapDeploySourceSection
                help={setupFieldHelp.bootstrap.source}
                mode={mode}
                deploySource={deploySource}
                onDeploySourceChange={setDeploySource}
                requiresFlake={requiresFlake}
                repoStatus={{
                  isPending: repoStatus.isPending,
                  isFetching: repoStatus.isFetching,
                  error: repoStatus.error,
                  data: repoStatus.data,
                }}
                formatSha={formatSha}
                onRefresh={() => {
                  if (!runnerOnline) return
                  void repoStatus.refetch()
                }}
                onPushNow={() => pushNow.mutate()}
                isPushing={pushNow.isPending}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    <span>Force</span>
                    <HelpTooltip title="Force" side="top">
                      {setupFieldHelp.bootstrap.force}
                    </HelpTooltip>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Skips doctor gate in CLI (not recommended).
                  </div>
                </div>
                <Switch checked={force} onCheckedChange={setForce} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    <span>Dry run</span>
                    <HelpTooltip title="Dry run" side="top">
                      {setupFieldHelp.bootstrap.dryRun}
                    </HelpTooltip>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Prints commands without executing.
                  </div>
                </div>
                <Switch checked={dryRun} onCheckedChange={setDryRun} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    <span>Auto-lockdown</span>
                    <HelpTooltip title="Auto-lockdown" side="top">
                      {setupFieldHelp.bootstrap.lockdownAfter}
                    </HelpTooltip>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Waits for tailnet to come up, then locks down public SSH.
                    {!canAutoLockdown ? " (requires nixos-anywhere + tailscale tailnet)" : ""}
                  </div>
                </div>
                <Switch
                  checked={lockdownAfterRequested && canAutoLockdown}
                  disabled={!canAutoLockdown}
                  onCheckedChange={(value) => {
                    if (!host) return
                    setLockdownAfterByHost((prev) => ({ ...prev, [host]: value }))
                  }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <AsyncButton
                type="button"
                variant="outline"
                disabled={doctorRun.isPending || !host || !runnerOnline}
                pending={doctorRun.isPending}
                pendingText="Running preflight..."
                onClick={() => doctorRun.mutate()}
              >
                Run preflight doctor
              </AsyncButton>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <AsyncButton
                      type="button"
                      disabled={start.isPending || !canBootstrap}
                      pending={start.isPending}
                      pendingText="Deploying..."
                    >
                      Deploy (initial install)
                    </AsyncButton>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Start deploy?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {cliCmd}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => start.mutate()}>Deploy</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <BootstrapChecklist
              projectId={projectId as Id<"projects">}
              host={host}
              hostDesired={hostSummary?.desired ?? null}
            />
          </div>

          {runId ? (
            <RunLogTail
              runId={runId}
              onDone={(status) => {
                if (status === "succeeded") onBootstrapped?.()
              }}
            />
          ) : null}
        </div>
      )}
    </>
  )

  if (variant === "embedded") return content

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      {content}
      <div className="text-xs text-muted-foreground">
        Need broader host deploy controls? Use the full host Deploy page.
      </div>
      <Button
        type="button"
        variant="outline"
        nativeButton={false}
        render={<Link to="/$projectSlug/hosts/$host/deploy" params={{ projectSlug, host }} />}
      >
        Open full Deploy page
      </Button>
    </div>
  )
}
