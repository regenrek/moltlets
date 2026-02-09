import type { Id } from "../../../../convex/_generated/dataModel"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import { Button } from "~/components/ui/button"

export function SetupStepCreds(props: {
  projectId: Id<"projects">
  isComplete: boolean
  onContinue: () => void
}) {
  return (
    <div className="space-y-4">
      <DeployCredsCard projectId={props.projectId} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!props.isComplete} onClick={props.onContinue}>
          Continue
        </Button>
        {!props.isComplete ? (
          <div className="text-xs text-muted-foreground">
            Set <code>SOPS_AGE_KEY_FILE</code> and <code>HCLOUD_TOKEN</code>.
          </div>
        ) : null}
      </div>
    </div>
  )
}
