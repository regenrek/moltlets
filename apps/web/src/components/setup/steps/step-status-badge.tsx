import { Badge } from "~/components/ui/badge"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import { cn } from "~/lib/utils"

export function setupStepStatusLabel(status: SetupStepStatus): string {
  if (status === "done") return "Complete"
  if (status === "active") return "In progress"
  if (status === "pending") return "Pending"
  return "Locked"
}

export function SetupStepStatusBadge(props: {
  status: SetupStepStatus
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        props.status === "done" && "border-emerald-300/70 bg-emerald-50 text-emerald-700",
        props.status === "active" && "bg-muted/30",
      )}
    >
      {setupStepStatusLabel(props.status)}
    </Badge>
  )
}
