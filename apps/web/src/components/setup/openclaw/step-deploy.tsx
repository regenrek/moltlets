import { DeployApplyChanges } from "~/components/deploy/deploy-apply"
import { Button } from "~/components/ui/button"

export function OpenClawSetupStepDeploy(props: {
  projectSlug: string
  host: string
  isComplete: boolean
  onContinue: () => void
}) {
  return (
    <div className="space-y-4">
      <DeployApplyChanges projectSlug={props.projectSlug} host={props.host} variant="embedded" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={!props.isComplete} onClick={props.onContinue}>
          Continue
        </Button>
      </div>
      {!props.isComplete ? (
        <div className="text-xs text-muted-foreground">
          This step unlocks after a successful updater apply run for this host.
        </div>
      ) : null}
    </div>
  )
}
