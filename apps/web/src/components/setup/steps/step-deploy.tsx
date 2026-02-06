import { Link } from "@tanstack/react-router"
import { DeployApplyChanges } from "~/components/deploy/deploy-apply"
import { DeployInitialInstall } from "~/components/deploy/deploy-initial"
import { Button } from "~/components/ui/button"

export function SetupStepDeploy(props: {
  projectSlug: string
  host: string
  hasBootstrapped: boolean
  onContinue: () => void
}) {
  return (
    <div className="space-y-4">
      {props.hasBootstrapped ? (
        <DeployApplyChanges projectSlug={props.projectSlug} host={props.host} variant="embedded" />
      ) : (
        <DeployInitialInstall
          projectSlug={props.projectSlug}
          host={props.host}
          variant="embedded"
          onBootstrapped={props.onContinue}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={!props.hasBootstrapped}
          onClick={props.onContinue}
        >
          Continue
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/$projectSlug/hosts/$host/deploy" params={{ projectSlug: props.projectSlug, host: props.host }} />}
        >
          Open full Deploy page
        </Button>
      </div>
      {!props.hasBootstrapped ? (
        <div className="text-xs text-muted-foreground">
          After the initial install succeeds, you’ll unlock Verify + hardening.
        </div>
      ) : null}
    </div>
  )
}

