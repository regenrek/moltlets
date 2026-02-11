import type { Id } from "../../../../convex/_generated/dataModel"
import { HostSecretsPanel } from "~/components/secrets/host-secrets-panel"

export function SetupStepSecrets(props: {
  projectId: Id<"projects">
  host: string
  isComplete: boolean
  onContinue: () => void
}) {
  return (
    <HostSecretsPanel
      projectId={props.projectId}
      host={props.host}
      scope="bootstrap"
      mode="setup"
      setupFlow={{
        isComplete: props.isComplete,
        onContinue: props.onContinue,
      }}
    />
  )
}
