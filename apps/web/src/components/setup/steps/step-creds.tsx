import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { deriveDeployReadiness, deriveFirstPushGuidance } from "~/components/deploy/deploy-setup-model"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import { SetupSaveStateBadge } from "~/components/setup/steps/setup-save-state-badge"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import { gitRepoStatus } from "~/domains/vcs"

export function SetupStepCreds(props: {
  projectId: Id<"projects">
  projectSlug: string
  projectRunnerRepoPath?: string | null
  hasProjectGithubToken: boolean
  stepStatus: SetupStepStatus
  isVisible: boolean
  onProjectCredsQueued?: () => void
}) {
  const runnersQuery = useQuery({
    ...convexQuery(
      api.controlPlane.runners.listByProject,
      props.isVisible ? { projectId: props.projectId } : "skip",
    ),
  })
  const runnerOnline = useMemo(
    () => isProjectRunnerOnline(runnersQuery.data ?? []),
    [runnersQuery.data],
  )
  const jobsQuery = useQuery({
    ...convexQuery(
      api.controlPlane.jobs.listByProject,
      props.isVisible
        ? {
            projectId: props.projectId,
            limit: 100,
          }
        : "skip",
    ),
  })
  const repoUrlHint = useMemo(
    () => {
      const jobs = jobsQuery.data ?? []
      for (const job of jobs) {
        if (job.kind !== "project_import") continue
        const repoUrl = typeof job.payload?.repoUrl === "string"
          ? job.payload.repoUrl.trim()
          : ""
        if (repoUrl) return repoUrl
      }
      return null
    },
    [jobsQuery.data],
  )
  const repoPathHint = useMemo(
    () => {
      const configured = String(props.projectRunnerRepoPath || "").trim()
      if (configured) return configured
      return `~/.clawlets/projects/${props.projectSlug}`
    },
    [props.projectRunnerRepoPath, props.projectSlug],
  )
  const [repoStatusChecked, setRepoStatusChecked] = useState(false)
  useEffect(() => {
    setRepoStatusChecked(false)
  }, [props.projectId])
  const repoStatus = useQuery({
    queryKey: ["gitRepoStatus", props.projectId],
    queryFn: async () => await gitRepoStatus({ data: { projectId: props.projectId } }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: false,
  })
  const gitReadiness = useMemo(
    () => {
      if (!repoStatusChecked) return null
      return deriveDeployReadiness({
        runnerOnline,
        repoPending: repoStatus.isPending,
        repoError: repoStatus.error,
        dirty: Boolean(repoStatus.data?.dirty),
        missingRev: !repoStatus.data?.originHead,
        needsPush: Boolean(repoStatus.data?.needsPush),
        localSelected: false,
        allowLocalDeploy: false,
      })
    },
    [
      repoStatus.data?.dirty,
      repoStatus.data?.needsPush,
      repoStatus.data?.originHead,
      repoStatus.error,
      repoStatus.isPending,
      repoStatusChecked,
      runnerOnline,
    ],
  )
  const githubReadiness = useMemo(
    () => {
      const alert = !gitReadiness || gitReadiness.reason === "ready" || gitReadiness.reason === "repo_pending"
        ? null
        : {
            severity: (
              gitReadiness.severity === "error"
                ? "error"
                : gitReadiness.severity === "warning"
                  ? "warning"
                  : "info"
            ) as "error" | "warning" | "info",
            message: gitReadiness.message,
            title: gitReadiness.title,
            detail: gitReadiness.detail,
          }
      return {
        runnerOnline,
        pending: repoStatusChecked && repoStatus.isPending,
        refreshing: repoStatus.isFetching,
        originHead: repoStatusChecked ? repoStatus.data?.originHead : undefined,
        branch: repoStatusChecked ? repoStatus.data?.branch : undefined,
        upstream: repoStatusChecked ? repoStatus.data?.upstream : undefined,
        ahead: repoStatusChecked ? repoStatus.data?.ahead : undefined,
        behind: repoStatusChecked ? repoStatus.data?.behind : undefined,
        onRefresh: () => {
          if (!runnerOnline) return
          setRepoStatusChecked(true)
          void repoStatus.refetch()
        },
        alert,
      }
    },
    [
      gitReadiness?.detail,
      gitReadiness?.message,
      gitReadiness?.reason,
      gitReadiness?.severity,
      gitReadiness?.title,
      repoStatus.data?.ahead,
      repoStatus.data?.behind,
      repoStatus.data?.branch,
      repoStatus.data?.originHead,
      repoStatus.data?.upstream,
      repoStatus.isFetching,
      repoStatus.isPending,
      repoStatusChecked,
      repoStatus.refetch,
      runnerOnline,
    ],
  )
  const githubFirstPushGuidance = useMemo(
    () =>
      deriveFirstPushGuidance({
        upstream: repoStatusChecked ? repoStatus.data?.upstream : null,
        runnerRepoPath: repoPathHint,
        repoUrlHint,
      }),
    [repoPathHint, repoStatus.data?.upstream, repoStatusChecked, repoUrlHint],
  )
  const githubTokenSaveState = props.hasProjectGithubToken ? "saved" : "not_saved"

  return (
    <div className="space-y-4">
      <DeployCredsCard
        projectId={props.projectId}
        setupHref={`/${props.projectSlug}/runner`}
        title="GitHub token"
        description="Project-wide token used for setup/deploy repository access."
        visibleKeys={["GITHUB_TOKEN"]}
        runnerStatusMode="none"
        statusSummary={{
          GITHUB_TOKEN: { status: props.hasProjectGithubToken ? "set" : "unset" },
        }}
        githubReadiness={githubReadiness}
        githubFirstPushGuidance={githubFirstPushGuidance}
        onQueued={props.onProjectCredsQueued}
        headerBadge={<SetupSaveStateBadge state={githubTokenSaveState} />}
      />
    </div>
  )
}
