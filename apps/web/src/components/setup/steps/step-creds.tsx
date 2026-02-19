import type { Id } from "../../../../convex/_generated/dataModel"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import { SetupSaveStateBadge } from "~/components/setup/steps/setup-save-state-badge"

export function SetupStepCreds(props: {
  projectId: Id<"projects">
  projectSlug: string
  hasProjectGithubToken: boolean
  hasProjectGitRemoteOrigin: boolean
  projectGitRemoteOrigin: string
  onProjectCredsQueued?: () => void
}) {
  const projectGitRemoteOrigin = String(props.projectGitRemoteOrigin || "").trim()
  const setupReadyState = props.hasProjectGithubToken && props.hasProjectGitRemoteOrigin ? "saved" : "not_saved"

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          Add your project GitHub repository and Github Deploy Token. A private repository is recommended.
          Use the repository HTTPS URL as the git remote origin in the next section.
        </p>
        <a
          href="https://github.com/new"
          target="_blank"
          rel="noreferrer"
          className="inline-flex underline underline-offset-4 hover:text-foreground"
        >
          Create a GitHub repository (recommended private)
        </a>
      </div>
      <DeployCredsCard
        projectId={props.projectId}
        setupHref={`/${props.projectSlug}/runner`}
        title="Git Configuration"
        description="Store GitHub Deploy Token and git remote origin for project-wide setup/deploy operations."
        visibleKeys={["GIT_REMOTE_ORIGIN", "GITHUB_TOKEN"]}
        runnerStatusMode="none"
        statusSummary={{
          GIT_REMOTE_ORIGIN: {
            status: props.hasProjectGitRemoteOrigin ? "set" : "unset",
            value: projectGitRemoteOrigin || undefined,
          },
          GITHUB_TOKEN: { status: props.hasProjectGithubToken ? "set" : "unset" },
        }}
        onQueued={props.onProjectCredsQueued}
        headerBadge={<SetupSaveStateBadge state={setupReadyState} />}
      />
    </div>
  )
}
