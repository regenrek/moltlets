import type { Id } from "../../../../convex/_generated/dataModel"
import { HostSecretsPanel } from "~/components/secrets/host-secrets-panel"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import type { SetupDraftView } from "~/sdk/setup"

export function SetupStepSecrets(props: {
  projectId: Id<"projects">
  host: string
  setupDraft: SetupDraftView | null
  stepStatus: SetupStepStatus
}) {
  return (
    <HostSecretsPanel
      projectId={props.projectId}
      host={props.host}
      scope="bootstrap"
      mode="setup"
      setupDraft={props.setupDraft}
      headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
    />
  )
}
