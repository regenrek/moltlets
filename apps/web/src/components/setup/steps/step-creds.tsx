import type { Id } from "../../../../convex/_generated/dataModel"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"

export function SetupStepCreds(props: {
  projectId: Id<"projects">
  isComplete: boolean
  onContinue: () => void
}) {
  return (
    <div className="space-y-4">
      <DeployCredsCard
        projectId={props.projectId}
        setupAction={{
          isComplete: props.isComplete,
          onContinue: props.onContinue,
        }}
      />
      {!props.isComplete ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            Set <code>HCLOUD_TOKEN</code>, <code>GITHUB_TOKEN</code>, and <code>SOPS_AGE_KEY_FILE</code>.
          </div>
          <div>
            Need a GitHub token?{" "}
            <a
              className="underline underline-offset-3 hover:text-foreground"
              href="https://docs.clawlets.com/dashboard/github-token"
              target="_blank"
              rel="noreferrer"
            >
              How to create GitHub token
            </a>
            .
          </div>
        </div>
      ) : null}
    </div>
  )
}
