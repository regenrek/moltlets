import { Badge } from "~/components/ui/badge"
import { cn } from "~/lib/utils"

export type SetupSaveState = "saved" | "not_saved" | "saving" | "error"

function label(state: SetupSaveState): string {
  if (state === "saved") return "Saved"
  if (state === "saving") return "Saving"
  if (state === "error") return "Error"
  return "Not saved"
}

export function SetupSaveStateBadge(props: { state: SetupSaveState }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        props.state === "saved" && "border-emerald-300/70 bg-emerald-50 text-emerald-700",
        props.state === "saving" && "border-amber-300/70 bg-amber-50 text-amber-700",
        props.state === "error" && "border-red-300/70 bg-red-50 text-red-700",
      )}
    >
      {label(props.state)}
    </Badge>
  )
}
