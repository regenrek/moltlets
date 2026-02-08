import { Link } from "@tanstack/react-router"
import type { Id } from "../../../../convex/_generated/dataModel"
import { HostSecretsPanel } from "~/components/secrets/host-secrets-panel"
import { Button } from "~/components/ui/button"

export function SetupStepSecrets(props: {
  projectSlug: string
  projectId: Id<"projects">
  host: string
  isComplete: boolean
  onContinue: () => void
}) {
  return (
    <div className="space-y-4">
      <HostSecretsPanel projectId={props.projectId} host={props.host} scope="bootstrap" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!props.isComplete} onClick={props.onContinue}>
          Continue
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/$projectSlug/hosts/$host/secrets" params={{ projectSlug: props.projectSlug, host: props.host }} />}
        >
          Open full Secrets page
        </Button>
      </div>
      {!props.isComplete ? (
        <div className="text-xs text-muted-foreground">
          Run Secrets Verify and resolve missing entries to unlock the next step.
        </div>
      ) : null}
    </div>
  )
}
