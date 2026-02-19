import type { Id } from "../../../convex/_generated/dataModel"

export function SetupSopsAgeKeyField(props: { projectId: Id<"projects"> }) {
  void props.projectId
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Operator workstation key</div>
      <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Project-wide SOPS path editing was removed. The SOPS age key path is host-scoped and written during setup apply.
      </div>
    </div>
  )
}
