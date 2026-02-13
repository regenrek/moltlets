import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { SettingsSection } from "~/components/ui/settings-section"
import { Spinner } from "~/components/ui/spinner"
import {
  deriveDeployReadiness,
  deriveFirstPushGuidance,
} from "~/components/deploy/deploy-setup-model"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import { gitRepoStatus } from "~/sdk/vcs"
import type { SetupDraftView } from "~/sdk/setup"

function formatShortSha(sha?: string | null): string {
  return String(sha || "").trim().slice(0, 7) || "none"
}

async function copyText(value: string): Promise<void> {
  if (!value.trim()) return
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    // ignore
  }
}

export function SetupStepPredeploy(props: {
  projectId: Id<"projects">
  host: string
  setupDraft: SetupDraftView | null
  stepStatus: SetupStepStatus
}) {
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId: props.projectId }),
  })
  const runnerOnline = useMemo(() => isProjectRunnerOnline(runnersQuery.data ?? []), [runnersQuery.data])

  const repoStatus = useQuery({
    queryKey: ["gitRepoStatus", props.projectId],
    queryFn: async () => await gitRepoStatus({ data: { projectId: props.projectId } }),
    enabled: runnerOnline,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const readiness = deriveDeployReadiness({
    runnerOnline,
    repoPending: repoStatus.isPending,
    repoError: repoStatus.error,
    missingRev: !repoStatus.data?.originHead,
    needsPush: Boolean(repoStatus.data?.needsPush),
    localSelected: false,
    allowLocalDeploy: false,
  })
  const firstPushGuidance = deriveFirstPushGuidance({ upstream: repoStatus.data?.upstream })

  const predeployReady = readiness.reason === "ready"
  const statusText = predeployReady
    ? "Ready for final deploy."
    : readiness.message

  return (
    <div className="space-y-4">
      <DeployCredsCard
        projectId={props.projectId}
        visibleKeys={["GITHUB_TOKEN", "SOPS_AGE_KEY_FILE"]}
        setupDraftFlow={{
          host: props.host,
          setupDraft: props.setupDraft,
        }}
        title="Provider tokens"
        description="GitHub token + SOPS key path. Stored as sealed setup draft and applied during setup apply."
        headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
      />

      <SettingsSection
        title="Pre-deploy checks"
        description="Check readiness and prepare for deploy."
        statusText={statusText}
      >
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">Git push readiness</div>
              <AsyncButton
                type="button"
                size="sm"
                variant="outline"
                disabled={!runnerOnline || repoStatus.isFetching}
                pending={repoStatus.isFetching}
                pendingText="Refreshing..."
                onClick={() => {
                  if (!runnerOnline) return
                  void repoStatus.refetch()
                }}
              >
                Refresh
              </AsyncButton>
            </div>

            {repoStatus.isPending ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="size-3" />
                Checking repo state...
              </div>
            ) : (
              <>
                <div className="space-y-1 text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>Revision to deploy</span>
                    <code>{formatShortSha(repoStatus.data?.originHead)}</code>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Branch</span>
                    <span>{repoStatus.data?.branch || "unknown"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Upstream</span>
                    <span>{repoStatus.data?.upstream || "unset"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">ahead {repoStatus.data?.ahead ?? 0}</Badge>
                  <Badge variant="outline">behind {repoStatus.data?.behind ?? 0}</Badge>
                </div>
              </>
            )}
          </div>

          {readiness.reason !== "ready" && readiness.reason !== "repo_pending" ? (
            <Alert
              variant={readiness.severity === "error" ? "destructive" : "default"}
              className={readiness.severity === "warning"
                ? "border-amber-300/50 bg-amber-50/50 text-amber-900 [&_[data-slot=alert-description]]:text-amber-900/90"
                : undefined}
            >
              <AlertTitle>{readiness.title || "Deploy blocked"}</AlertTitle>
              <AlertDescription>
                {readiness.detail || readiness.message}
              </AlertDescription>
            </Alert>
          ) : null}

          {readiness.showFirstPushGuidance ? (
            <div className="rounded-md border bg-background p-3 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">First push help</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyText(firstPushGuidance.commands)}
                >
                  Copy commands
                </Button>
              </div>
              <div className="text-muted-foreground">
                {firstPushGuidance.hasUpstream
                  ? `Upstream detected (${repoStatus.data?.upstream}). Push once, then refresh.`
                  : "No upstream detected. Set or update origin, push once, then refresh."}
              </div>
              <pre className="rounded-md border bg-muted/30 p-2 whitespace-pre-wrap break-words">
                {firstPushGuidance.commands}
              </pre>
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  )
}
