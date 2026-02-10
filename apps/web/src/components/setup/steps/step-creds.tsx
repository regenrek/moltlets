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
        <div className="text-xs text-muted-foreground">
          Set <code>SOPS_AGE_KEY_FILE</code> and <code>HCLOUD_TOKEN</code>.
        </div>
      ) : null}
    </div>
  )
}
