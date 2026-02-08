import type { Id } from "../../../../convex/_generated/dataModel"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import { Button } from "~/components/ui/button"

export function SetupStepCreds(props: {
  projectId: Id<"projects">
  isComplete: boolean
  onContinue: () => void
  provider: "hetzner" | "aws"
}) {
  const providerTokenNode = props.provider === "aws"
    ? (
        <>
          <code>AWS_ACCESS_KEY_ID</code> and <code>AWS_SECRET_ACCESS_KEY</code>
        </>
      )
    : <code>HCLOUD_TOKEN</code>

  return (
    <div className="space-y-4">
      <DeployCredsCard projectId={props.projectId} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!props.isComplete} onClick={props.onContinue}>
          Continue
        </Button>
        {!props.isComplete ? (
          <div className="text-xs text-muted-foreground">
            Set <code>SOPS_AGE_KEY_FILE</code> and {providerTokenNode}.
          </div>
        ) : null}
      </div>
    </div>
  )
}
