import { Link } from "@tanstack/react-router"
import type { Id } from "../../../../convex/_generated/dataModel"
import { BootstrapChecklist } from "~/components/hosts/bootstrap-checklist"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import { Button } from "~/components/ui/button"
import type { SetupStepStatus } from "~/lib/setup/setup-model"

export function SetupStepVerify(props: {
  projectSlug: string
  projectId: Id<"projects">
  host: string
  config: any
  stepStatus: SetupStepStatus
}) {
  return (
    <div className="space-y-4">
      <BootstrapChecklist
        projectId={props.projectId}
        host={props.host}
        config={props.config}
        headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/$projectSlug/hosts/$host/settings" params={{ projectSlug: props.projectSlug, host: props.host }} />}
        >
          Open host settings
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/$projectSlug/hosts/$host/deploy" params={{ projectSlug: props.projectSlug, host: props.host }} />}
        >
          Back to Deploy
        </Button>
      </div>
    </div>
  )
}
