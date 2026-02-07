import { Link } from "@tanstack/react-router"
import { Button } from "~/components/ui/button"

export function OpenClawSetupStepGateway(props: {
  projectSlug: string
  host: string
  isComplete: boolean
  onContinue: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Add at least one gateway and basic channel/agent config.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          nativeButton={false}
          render={<Link to="/$projectSlug/hosts/$host/gateways" params={{ projectSlug: props.projectSlug, host: props.host }} />}
        >
          Open Gateways
        </Button>
        <Button type="button" variant="outline" disabled={!props.isComplete} onClick={props.onContinue}>
          Continue
        </Button>
      </div>
      {!props.isComplete ? (
        <div className="text-xs text-muted-foreground">
          This step unlocks after at least one gateway exists.
        </div>
      ) : null}
    </div>
  )
}
