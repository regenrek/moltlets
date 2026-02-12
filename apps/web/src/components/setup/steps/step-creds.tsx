import type { Id } from "../../../../convex/_generated/dataModel"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import type { SetupDraftView } from "~/sdk/setup"

export function SetupStepCreds(props: {
  projectId: Id<"projects">
  host: string
  setupDraft: SetupDraftView | null
  stepStatus: SetupStepStatus
}) {
  return (
    <div className="space-y-4">
      <DeployCredsCard
        projectId={props.projectId}
        visibleKeys={["GITHUB_TOKEN", "SOPS_AGE_KEY_FILE"]}
        setupDraftFlow={{
          host: props.host,
          setupDraft: props.setupDraft,
        }}
        headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
      />
    </div>
  )
}
